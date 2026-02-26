import { DB } from "../../../db";
import { eq, and, or } from "drizzle-orm";
import { PublisherModel } from "../shared-models/publisher";
import { AuthHandler } from "../authHandler";

/**
 * Service for checking and managing permissions within publishers and groups
 */
export class PermissionsService {

    /**
     * Get member record for a user in a publisher (or specific group)
     */
    static async getMembership(params: {
        userId: number;
        publisherId: number;
        groupId?: number;
    }): Promise<DB.Models.PublisherMember | undefined> {
        const { userId, publisherId, groupId } = params;

        // First try to find group-specific membership
        if (groupId !== undefined) {
            const groupMember = await DB.instance()
                .select()
                .from(DB.Schema.publisherMembers)
                .where(and(
                    eq(DB.Schema.publisherMembers.user_id, userId),
                    eq(DB.Schema.publisherMembers.publisher_id, publisherId),
                    eq(DB.Schema.publisherMembers.group_id, groupId)
                ))
                .get();
            
            if (groupMember) return groupMember;
        }

        // Fall back to publisher-level membership
        const publisherMember = await DB.instance()
            .select()
            .from(DB.Schema.publisherMembers)
            .where(and(
                eq(DB.Schema.publisherMembers.user_id, userId),
                eq(DB.Schema.publisherMembers.publisher_id, publisherId),
                eq(DB.Schema.publisherMembers.group_id, null as any)
            ))
            .get();

        return publisherMember;
    }

    /**
     * Get all memberships for a user in a publisher (including inherited from parent groups)
     */
    static async getAllMemberships(params: {
        userId: number;
        publisherId: number;
        groupId?: number;
    }): Promise<DB.Models.PublisherMember[]> {
        const { userId, publisherId, groupId } = params;

        // Get all memberships for this user in this publisher
        const memberships = await DB.instance()
            .select()
            .from(DB.Schema.publisherMembers)
            .where(and(
                eq(DB.Schema.publisherMembers.user_id, userId),
                eq(DB.Schema.publisherMembers.publisher_id, publisherId)
            ))
            .all();

        // If checking for a specific group, include parent group memberships
        if (groupId !== undefined) {
            const group = await DB.instance()
                .select()
                .from(DB.Schema.publisherGroups)
                .where(eq(DB.Schema.publisherGroups.id, groupId))
                .get();

            if (group?.parent_group_id) {
                const parentMemberships = await this.getAllMemberships({
                    userId,
                    publisherId,
                    groupId: group.parent_group_id
                });
                memberships.push(...parentMemberships);
            }
        }

        return memberships;
    }

    /**
     * Get effective permissions for a user (highest from all memberships)
     */
    static async getEffectivePermissions(params: {
        userId: number;
        publisherId: number;
        groupId?: number;
    }): Promise<PublisherModel.MemberPermissions | null> {
        const memberships = await this.getAllMemberships(params);

        if (memberships.length === 0) return null;

        // Aggregate permissions (any "true" wins)
        const effectivePermissions: PublisherModel.MemberPermissions = {
            canCreatePackages: false,
            canEditPackages: false,
            canDeletePackages: false,
            canPushReleases: false,
            canManageMembers: false,
            canCreateGroups: false,
            canRequestTopLevelAlias: false,
        };

        for (const membership of memberships) {
            const perms = membership.permissions as PublisherModel.MemberPermissions;
            Object.keys(effectivePermissions).forEach((key) => {
                const k = key as keyof PublisherModel.MemberPermissions;
                if (perms[k]) {
                    effectivePermissions[k] = true;
                }
            });
        }

        return effectivePermissions;
    }

    /**
     * Check if user has a specific permission
     */
    static async hasPermission(params: {
        userId: number;
        publisherId: number;
        groupId?: number;
        permission: keyof PublisherModel.MemberPermissions;
    }): Promise<boolean> {
        const { userId, publisherId, groupId, permission } = params;

        const effectivePermissions = await this.getEffectivePermissions({
            userId,
            publisherId,
            groupId
        });

        return effectivePermissions?.[permission] ?? false;
    }

    /**
     * Check if user is a member of publisher/group
     */
    static async isMember(params: {
        userId: number;
        publisherId: number;
        groupId?: number;
    }): Promise<boolean> {
        const membership = await this.getMembership(params);
        return membership !== undefined;
    }

    /**
     * Check if user has owner role in publisher
     */
    static async isOwner(params: {
        userId: number;
        publisherId: number;
    }): Promise<boolean> {
        const membership = await this.getMembership({
            userId: params.userId,
            publisherId: params.publisherId
        });

        return membership?.role === 'owner';
    }

    /**
     * Check if user is admin or has permission
     */
    static async hasPermissionOrAdmin(params: {
        authContext: AuthHandler.AuthContext;
        publisherId: number;
        groupId?: number;
        permission: keyof PublisherModel.MemberPermissions;
    }): Promise<boolean> {
        const { authContext, publisherId, groupId, permission } = params;

        // Admins bypass permission checks
        if (authContext.user_role === 'admin') {
            return true;
        }

        return await this.hasPermission({
            userId: authContext.user_id,
            publisherId,
            groupId,
            permission
        });
    }

    /**
     * Get permissions for role
     */
    static getPermissionsForRole(role: PublisherModel.MemberRole): PublisherModel.MemberPermissions {
        return PublisherModel.DefaultPermissions[role];
    }

    /**
     * Merge custom permissions with role defaults
     */
    static mergePermissions(
        role: PublisherModel.MemberRole,
        customPermissions?: Partial<PublisherModel.MemberPermissions>
    ): PublisherModel.MemberPermissions {
        const defaults = this.getPermissionsForRole(role);
        return {
            ...defaults,
            ...customPermissions
        };
    }
}
