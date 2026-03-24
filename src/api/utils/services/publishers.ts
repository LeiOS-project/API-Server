import type { Context } from "hono";
import { DB } from "../../../db";
import { APIResponse } from "../api-res";
import { PublisherModel } from "../shared-models/publisher";
import { eq, and, or } from "drizzle-orm";
import { AuthHandler } from "../authHandler";
import { PermissionsService } from "./permissions";

export class PublishersService {

    /**
     * Get all publishers (optionally filter by visibility)
     */
    static async getAllPublishers(c: Context, options: {
        includePrivate?: boolean;
        userId?: number;
    } = {}) {
        const { includePrivate = false, userId } = options;

        let publishers;

        if (includePrivate && userId) {
            // Include private publishers where user is a member
            const allPublishers = await DB.instance().select().from(DB.Tables.publishers).all();
            
            const filtered = [];
            for (const pub of allPublishers) {
                if (pub.visibility === 'public') {
                    filtered.push(pub);
                } else {
                    // Check if user is member
                    const isMember = await PermissionsService.isMember({
                        userId,
                        publisherId: pub.id
                    });
                    if (isMember) {
                        filtered.push(pub);
                    }
                }
            }
            publishers = filtered;
        } else {
            // Only public publishers
            publishers = await DB.instance()
                .select()
                .from(DB.Tables.publishers)
                .where(eq(DB.Tables.publishers.visibility, 'public'))
                .all();
        }

        return APIResponse.success(c, "Publishers retrieved successfully", publishers);
    }

    /**
     * Get a specific publisher by name or ID
     */
    static async getPublisher(c: Context, identifier: string | number, userId?: number) {
        let publisher;

        if (typeof identifier === 'number') {
            publisher = await DB.instance()
                .select()
                .from(DB.Tables.publishers)
                .where(eq(DB.Tables.publishers.id, identifier))
                .get();
        } else {
            publisher = await DB.instance()
                .select()
                .from(DB.Tables.publishers)
                .where(eq(DB.Tables.publishers.name, identifier))
                .get();
        }

        if (!publisher) {
            return APIResponse.notFound(c, "Publisher not found");
        }

        // Check visibility
        if (publisher.visibility === 'private' && userId) {
            const isMember = await PermissionsService.isMember({
                userId,
                publisherId: publisher.id
            });
            if (!isMember) {
                return APIResponse.forbidden(c, "You do not have access to this publisher");
            }
        } else if (publisher.visibility === 'private') {
            return APIResponse.forbidden(c, "This publisher is private");
        }

        return APIResponse.success(c, "Publisher retrieved successfully", publisher);
    }

    /**
     * Create a new publisher
     */
    static async createPublisher(
        c: Context,
        publisherData: PublisherModel.CreatePublisher.Body,
        authContext: AuthHandler.AuthContext
    ) {
        // Check if publisher name already exists
        const existing = await DB.instance()
            .select()
            .from(DB.Tables.publishers)
            .where(eq(DB.Tables.publishers.name, publisherData.name))
            .get();

        if (existing) {
            return APIResponse.conflict(c, "Publisher with this name already exists");
        }

        // Create publisher
        const publisher = await DB.instance()
            .insert(DB.Tables.publishers)
            .values({
                ...publisherData,
                created_by_user_id: authContext.user_id
            })
            .returning()
            .get();

        // Add creator as owner
        await DB.instance()
            .insert(DB.Tables.publisherMembers)
            .values({
                publisher_id: publisher.id,
                user_id: authContext.user_id,
                role: 'owner',
                permissions: PermissionsService.getPermissionsForRole('owner'),
                invited_by_user_id: null
            });

        return APIResponse.created(c, "Publisher created successfully", { id: publisher.id });
    }

    /**
     * Update a publisher
     */
    static async updatePublisher(
        c: Context,
        publisherId: number,
        updateData: PublisherModel.UpdatePublisher.Body,
        authContext: AuthHandler.AuthContext
    ) {
        // Check if user has permission
        const hasPermission = await PermissionsService.hasPermissionOrAdmin({
            authContext,
            publisherId,
            permission: 'canManageMembers' // Owners/maintainers can update publisher settings
        });

        if (!hasPermission) {
            return APIResponse.forbidden(c, "You do not have permission to update this publisher");
        }

        // Update publisher
        await DB.instance()
            .update(DB.Tables.publishers)
            .set(updateData)
            .where(eq(DB.Tables.publishers.id, publisherId));

        return APIResponse.successNoData(c, "Publisher updated successfully");
    }

    /**
     * Delete a publisher (only owners)
     */
    static async deletePublisher(
        c: Context,
        publisherId: number,
        authContext: AuthHandler.AuthContext
    ) {
        // Only owners or admins can delete
        const isOwner = await PermissionsService.isOwner({
            userId: authContext.user_id,
            publisherId
        });

        if (!isOwner && authContext.user_role !== 'admin') {
            return APIResponse.forbidden(c, "Only owners can delete publishers");
        }

        // Check if publisher has packages
        const packages = await DB.instance()
            .select()
            .from(DB.Tables.packages)
            .where(eq(DB.Tables.packages.publisher_id, publisherId))
            .limit(1)
            .all();

        if (packages.length > 0) {
            return APIResponse.badRequest(c, "Cannot delete publisher with existing packages. Delete packages first.");
        }

        // Delete publisher (cascades to groups and members)
        await DB.instance()
            .delete(DB.Tables.publishers)
            .where(eq(DB.Tables.publishers.id, publisherId));

        return APIResponse.successNoData(c, "Publisher deleted successfully");
    }

    /**
     * Create a subgroup within a publisher
     */
    static async createGroup(
        c: Context,
        publisherId: number,
        groupData: PublisherModel.CreateGroup.Body,
        authContext: AuthHandler.AuthContext
    ) {
        // Check permission
        const hasPermission = await PermissionsService.hasPermissionOrAdmin({
            authContext,
            publisherId,
            groupId: groupData.parent_group_id ?? undefined,
            permission: 'canCreateGroups'
        });

        if (!hasPermission) {
            return APIResponse.forbidden(c, "You do not have permission to create groups in this publisher");
        }

        // Verify parent group exists if specified
        if (groupData.parent_group_id) {
            const parentGroup = await DB.instance()
                .select()
                .from(DB.Tables.publisherGroups)
                .where(eq(DB.Tables.publisherGroups.id, groupData.parent_group_id))
                .get();

            if (!parentGroup || parentGroup.publisher_id !== publisherId) {
                return APIResponse.badRequest(c, "Invalid parent group");
            }
        }

        // Check if group name already exists in this publisher/parent
        const existing = await DB.instance()
            .select()
            .from(DB.Tables.publisherGroups)
            .where(and(
                eq(DB.Tables.publisherGroups.publisher_id, publisherId),
                eq(DB.Tables.publisherGroups.name, groupData.name),
                groupData.parent_group_id 
                    ? eq(DB.Tables.publisherGroups.parent_group_id, groupData.parent_group_id)
                    : eq(DB.Tables.publisherGroups.parent_group_id, null as any)
            ))
            .get();

        if (existing) {
            return APIResponse.conflict(c, "Group with this name already exists in this location");
        }

        // Create group
        const group = await DB.instance()
            .insert(DB.Tables.publisherGroups)
            .values({
                ...groupData,
                publisher_id: publisherId,
                created_by_user_id: authContext.user_id
            })
            .returning()
            .get();

        return APIResponse.created(c, "Group created successfully", { id: group.id });
    }

    /**
     * Get all groups in a publisher
     */
    static async getGroups(c: Context, publisherId: number, parentGroupId?: number) {
        const groups = await DB.instance()
            .select()
            .from(DB.Tables.publisherGroups)
            .where(and(
                eq(DB.Tables.publisherGroups.publisher_id, publisherId),
                parentGroupId !== undefined
                    ? eq(DB.Tables.publisherGroups.parent_group_id, parentGroupId)
                    : eq(DB.Tables.publisherGroups.parent_group_id, null as any)
            ))
            .all();

        return APIResponse.success(c, "Groups retrieved successfully", groups);
    }

    /**
     * Add a member to publisher/group
     */
    static async addMember(
        c: Context,
        publisherId: number,
        memberData: PublisherModel.AddMember.Body,
        authContext: AuthHandler.AuthContext
    ) {
        // Check permission
        const hasPermission = await PermissionsService.hasPermissionOrAdmin({
            authContext,
            publisherId,
            groupId: memberData.group_id,
            permission: 'canManageMembers'
        });

        if (!hasPermission) {
            return APIResponse.forbidden(c, "You do not have permission to manage members");
        }

        // Verify user exists
        const user = await DB.instance()
            .select()
            .from(DB.Tables.users)
            .where(eq(DB.Tables.users.id, memberData.user_id))
            .get();

        if (!user) {
            return APIResponse.notFound(c, "User not found");
        }

        // Check if already a member
        const existing = await DB.instance()
            .select()
            .from(DB.Tables.publisherMembers)
            .where(and(
                eq(DB.Tables.publisherMembers.publisher_id, publisherId),
                eq(DB.Tables.publisherMembers.user_id, memberData.user_id),
                memberData.group_id
                    ? eq(DB.Tables.publisherMembers.group_id, memberData.group_id)
                    : eq(DB.Tables.publisherMembers.group_id, null as any)
            ))
            .get();

        if (existing) {
            return APIResponse.conflict(c, "User is already a member");
        }

        // Add member
        const permissions = PermissionsService.mergePermissions(
            memberData.role,
            memberData.permissions
        );

        await DB.instance()
            .insert(DB.Tables.publisherMembers)
            .values({
                publisher_id: publisherId,
                group_id: memberData.group_id ?? null,
                user_id: memberData.user_id,
                role: memberData.role,
                permissions,
                invited_by_user_id: authContext.user_id
            });

        return APIResponse.createdNoData(c, "Member added successfully");
    }

    /**
     * Get all members of publisher/group
     */
    static async getMembers(c: Context, publisherId: number, groupId?: number) {
        const members = await DB.instance()
            .select()
            .from(DB.Tables.publisherMembers)
            .where(and(
                eq(DB.Tables.publisherMembers.publisher_id, publisherId),
                groupId !== undefined
                    ? eq(DB.Tables.publisherMembers.group_id, groupId)
                    : eq(DB.Tables.publisherMembers.group_id, null as any)
            ))
            .all();

        return APIResponse.success(c, "Members retrieved successfully", members);
    }

    /**
     * Remove a member from publisher/group
     */
    static async removeMember(
        c: Context,
        publisherId: number,
        memberId: number,
        authContext: AuthHandler.AuthContext
    ) {
        // Check permission
        const hasPermission = await PermissionsService.hasPermissionOrAdmin({
            authContext,
            publisherId,
            permission: 'canManageMembers'
        });

        if (!hasPermission) {
            return APIResponse.forbidden(c, "You do not have permission to manage members");
        }

        // Cannot remove yourself if you're the last owner
        const member = await DB.instance()
            .select()
            .from(DB.Tables.publisherMembers)
            .where(eq(DB.Tables.publisherMembers.id, memberId))
            .get();

        if (member?.role === 'owner' && member.user_id === authContext.user_id) {
            const ownerCount = await DB.instance()
                .select()
                .from(DB.Tables.publisherMembers)
                .where(and(
                    eq(DB.Tables.publisherMembers.publisher_id, publisherId),
                    eq(DB.Tables.publisherMembers.role, 'owner')
                ))
                .all();

            if (ownerCount.length <= 1) {
                return APIResponse.badRequest(c, "Cannot remove the last owner. Transfer ownership first.");
            }
        }

        // Remove member
        await DB.instance()
            .delete(DB.Tables.publisherMembers)
            .where(eq(DB.Tables.publisherMembers.id, memberId));

        return APIResponse.successNoData(c, "Member removed successfully");
    }
}
