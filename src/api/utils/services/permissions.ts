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
                .from(DB.Tables.publisherMembers)
                .where(and(
                    eq(DB.Tables.publisherMembers.user_id, userId),
                    eq(DB.Tables.publisherMembers.publisher_id, publisherId),
                    eq(DB.Tables.publisherMembers.group_id, groupId)
                ))
                .get();
            
            if (groupMember) return groupMember;
        }

        // Fall back to publisher-level membership
        const publisherMember = await DB.instance()
            .select()
            .from(DB.Tables.publisherMembers)
            .where(and(
                eq(DB.Tables.publisherMembers.user_id, userId),
                eq(DB.Tables.publisherMembers.publisher_id, publisherId),
                eq(DB.Tables.publisherMembers.group_id, null as any)
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
            .from(DB.Tables.publisherMembers)
            .where(and(
                eq(DB.Tables.publisherMembers.user_id, userId),
                eq(DB.Tables.publisherMembers.publisher_id, publisherId)
            ))
            .all();

        // If checking for a specific group, include parent group memberships
        if (groupId !== undefined) {
            const group = await DB.instance()
                .select()
                .from(DB.Tables.publisherGroups)
                .where(eq(DB.Tables.publisherGroups.id, groupId))
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

    // ==================== NEW ROLE-BASED PERMISSION SYSTEM ====================

    /**
     * Get all role assignments for a user in a specific scope
     * Includes inherited assignments from parent scopes
     */
    static async getRoleAssignments(params: {
        userId: number;
        publisherId: number;
        groupId?: number;
        packageId?: number;
    }): Promise<Array<DB.Models.RoleAssignment & { role: DB.Models.Role }>> {
        const { userId, publisherId, groupId, packageId } = params;

        const assignments: Array<DB.Models.RoleAssignment & { role: DB.Models.Role }> = [];

        // 1. Get publisher-level assignments
        const publisherAssignments = await DB.instance()
            .select()
            .from(DB.Tables.roleAssignments)
            .innerJoin(DB.Tables.roles, eq(DB.Tables.roleAssignments.role_id, DB.Tables.roles.id))
            .where(and(
                eq(DB.Tables.roleAssignments.user_id, userId),
                eq(DB.Tables.roleAssignments.publisher_id, publisherId),
                eq(DB.Tables.roleAssignments.group_id, null as any),
                eq(DB.Tables.roleAssignments.package_id, null as any)
            ))
            .all();

        assignments.push(...publisherAssignments.map(a => ({ ...a.role_assignments, role: a.roles })));

        // 2. If checking for a group, get group-level assignments (including parent groups)
        if (groupId !== undefined) {
            const groupAssignments = await this.getGroupRoleAssignments({
                userId,
                publisherId,
                groupId
            });
            assignments.push(...groupAssignments);
        }

        // 3. If checking for a package, get package-level assignments
        if (packageId !== undefined) {
            const packageAssignments = await DB.instance()
                .select()
                .from(DB.Tables.roleAssignments)
                .innerJoin(DB.Tables.roles, eq(DB.Tables.roleAssignments.role_id, DB.Tables.roles.id))
                .where(and(
                    eq(DB.Tables.roleAssignments.user_id, userId),
                    eq(DB.Tables.roleAssignments.publisher_id, publisherId),
                    eq(DB.Tables.roleAssignments.package_id, packageId)
                ))
                .all();

            assignments.push(...packageAssignments.map(a => ({ ...a.role_assignments, role: a.roles })));
        }

        return assignments;
    }

    /**
     * Get role assignments for a user in a group (including parent groups)
     */
    private static async getGroupRoleAssignments(params: {
        userId: number;
        publisherId: number;
        groupId: number;
    }): Promise<Array<DB.Models.RoleAssignment & { role: DB.Models.Role }>> {
        const { userId, publisherId, groupId } = params;
        const assignments: Array<DB.Models.RoleAssignment & { role: DB.Models.Role }> = [];

        // Get group-level assignments for this group
        const groupAssignments = await DB.instance()
            .select()
            .from(DB.Tables.roleAssignments)
            .innerJoin(DB.Tables.roles, eq(DB.Tables.roleAssignments.role_id, DB.Tables.roles.id))
            .where(and(
                eq(DB.Tables.roleAssignments.user_id, userId),
                eq(DB.Tables.roleAssignments.publisher_id, publisherId),
                eq(DB.Tables.roleAssignments.group_id, groupId)
            ))
            .all();

        assignments.push(...groupAssignments.map(a => ({ ...a.role_assignments, role: a.roles })));

        // Get parent group and recursively get its assignments
        const group = await DB.instance()
            .select()
            .from(DB.Tables.publisherGroups)
            .where(eq(DB.Tables.publisherGroups.id, groupId))
            .get();

        if (group?.parent_group_id) {
            const parentAssignments = await this.getGroupRoleAssignments({
                userId,
                publisherId,
                groupId: group.parent_group_id
            });
            assignments.push(...parentAssignments);
        }

        return assignments;
    }

    /**
     * Get effective permissions for a user based on their role assignments
     * Higher level permissions are accumulated (any "true" wins)
     */
    static async getEffectiveRolePermissions(params: {
        userId: number;
        publisherId: number;
        groupId?: number;
        packageId?: number;
    }): Promise<PublisherModel.RolePermissions | null> {
        const assignments = await this.getRoleAssignments(params);

        if (assignments.length === 0) return null;

        // Aggregate permissions (any "true" wins)
        const effectivePermissions: PublisherModel.RolePermissions = {
            canCreatePackages: false,
            canEditPackages: false,
            canDeletePackages: false,
            canPushReleases: false,
            canManageMembers: false,
            canManageRoles: false,
            canCreateGroups: false,
            canEditGroups: false,
            canDeleteGroups: false,
            canRequestTopLevelAlias: false,
            canViewPrivate: false,
        };

        for (const assignment of assignments) {
            const perms = assignment.role.permissions as PublisherModel.RolePermissions;
            Object.keys(effectivePermissions).forEach((key) => {
                const k = key as keyof PublisherModel.RolePermissions;
                if (perms[k]) {
                    effectivePermissions[k] = true;
                }
            });
        }

        return effectivePermissions;
    }

    /**
     * Check if user has a specific permission using the role-based system
     */
    static async hasRolePermission(params: {
        userId: number;
        publisherId: number;
        groupId?: number;
        packageId?: number;
        permission: keyof PublisherModel.RolePermissions;
    }): Promise<boolean> {
        const { userId, publisherId, groupId, packageId, permission } = params;

        const effectivePermissions = await this.getEffectiveRolePermissions({
            userId,
            publisherId,
            groupId,
            packageId
        });

        return effectivePermissions?.[permission] ?? false;
    }

    /**
     * Check if user has a specific permission or is an admin (using role-based system)
     */
    static async hasRolePermissionOrAdmin(params: {
        authContext: AuthHandler.AuthContext;
        publisherId: number;
        groupId?: number;
        packageId?: number;
        permission: keyof PublisherModel.RolePermissions;
    }): Promise<boolean> {
        const { authContext, publisherId, groupId, packageId, permission } = params;

        // Admins bypass permission checks
        if (authContext.user_role === 'admin') {
            return true;
        }

        return await this.hasRolePermission({
            userId: authContext.user_id,
            publisherId,
            groupId,
            packageId,
            permission
        });
    }

    /**
     * Check if user is a member (has any role assignment) in the specified scope
     */
    static async isRoleMember(params: {
        userId: number;
        publisherId: number;
        groupId?: number;
        packageId?: number;
    }): Promise<boolean> {
        const assignments = await this.getRoleAssignments(params);
        return assignments.length > 0;
    }

    /**
     * Check if user has the "owner" role in a publisher
     */
    static async hasOwnerRole(params: {
        userId: number;
        publisherId: number;
    }): Promise<boolean> {
        const assignments = await this.getRoleAssignments(params);
        return assignments.some(a => a.role.name === 'owner');
    }

    /**
     * Initialize system roles (should be called on first setup)
     */
    static async initializeSystemRoles(): Promise<void> {
        for (const roleName of PublisherModel.SystemRoleNames) {
            // Check if role already exists
            const existing = await DB.instance()
                .select()
                .from(DB.Tables.roles)
                .where(and(
                    eq(DB.Tables.roles.name, roleName),
                    eq(DB.Tables.roles.is_system, true)
                ))
                .get();

            if (!existing) {
                await DB.instance()
                    .insert(DB.Tables.roles)
                    .values({
                        name: roleName,
                        display_name: roleName.charAt(0).toUpperCase() + roleName.slice(1),
                        description: `System role: ${roleName}`,
                        is_system: true,
                        publisher_id: null,
                        permissions: PublisherModel.SystemRolePermissions[roleName],
                        created_by_user_id: null,
                    });
            }
        }
    }

    /**
     * Get system role by name
     */
    static async getSystemRole(roleName: PublisherModel.SystemRoleName): Promise<DB.Models.Role | undefined> {
        return await DB.instance()
            .select()
            .from(DB.Tables.roles)
            .where(and(
                eq(DB.Tables.roles.name, roleName),
                eq(DB.Tables.roles.is_system, true)
            ))
            .get();
    }
}

