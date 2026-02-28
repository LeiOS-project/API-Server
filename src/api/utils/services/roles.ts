import { DB } from "../../../db";
import { eq, and } from "drizzle-orm";
import { PublisherModel } from "../shared-models/publisher";
import { AuthHandler } from "../authHandler";
import { APIResponse } from "../api-res";
import { PermissionsService } from "./permissions";
import type { Context } from "hono";

/**
 * Service for managing roles and role assignments
 */
export class RolesService {

    /**
     * Create a new custom role within a publisher
     */
    static async createRole(
        c: Context,
        publisherId: number,
        roleData: PublisherModel.CreateRole.Body,
        authContext: AuthHandler.AuthContext
    ) {
        // Check permission
        const hasPermission = await PermissionsService.hasRolePermissionOrAdmin({
            authContext,
            publisherId,
            permission: 'canManageRoles'
        });

        if (!hasPermission) {
            return APIResponse.forbidden(c, "You do not have permission to manage roles");
        }

        // Check if role name already exists in this publisher
        const existing = await DB.instance()
            .select()
            .from(DB.Schema.roles)
            .where(and(
                eq(DB.Schema.roles.name, roleData.name),
                eq(DB.Schema.roles.publisher_id, publisherId)
            ))
            .get();

        if (existing) {
            return APIResponse.conflict(c, "A role with this name already exists in this publisher");
        }

        // Create role
        const role = await DB.instance()
            .insert(DB.Schema.roles)
            .values({
                name: roleData.name,
                display_name: roleData.display_name,
                description: roleData.description,
                is_system: false,
                publisher_id: publisherId,
                permissions: roleData.permissions,
                created_by_user_id: authContext.user_id,
            })
            .returning()
            .get();

        return APIResponse.created(c, "Role created successfully", { id: role.id });
    }

    /**
     * Get all roles for a publisher (including system roles)
     */
    static async getRoles(c: Context, publisherId: number) {
        // Get system roles
        const systemRoles = await DB.instance()
            .select()
            .from(DB.Schema.roles)
            .where(and(
                eq(DB.Schema.roles.is_system, true),
                eq(DB.Schema.roles.publisher_id, null as any)
            ))
            .all();

        // Get publisher-specific roles
        const publisherRoles = await DB.instance()
            .select()
            .from(DB.Schema.roles)
            .where(eq(DB.Schema.roles.publisher_id, publisherId))
            .all();

        const allRoles = [...systemRoles, ...publisherRoles];

        return APIResponse.success(c, "Roles retrieved successfully", allRoles);
    }

    /**
     * Get a specific role
     */
    static async getRole(c: Context, roleId: number) {
        const role = await DB.instance()
            .select()
            .from(DB.Schema.roles)
            .where(eq(DB.Schema.roles.id, roleId))
            .get();

        if (!role) {
            return APIResponse.notFound(c, "Role not found");
        }

        return APIResponse.success(c, "Role retrieved successfully", role);
    }

    /**
     * Update a custom role
     */
    static async updateRole(
        c: Context,
        roleId: number,
        updateData: PublisherModel.UpdateRole.Body,
        authContext: AuthHandler.AuthContext
    ) {
        const role = await DB.instance()
            .select()
            .from(DB.Schema.roles)
            .where(eq(DB.Schema.roles.id, roleId))
            .get();

        if (!role) {
            return APIResponse.notFound(c, "Role not found");
        }

        // Cannot update system roles
        if (role.is_system) {
            return APIResponse.forbidden(c, "Cannot update system roles");
        }

        // Check permission
        const hasPermission = await PermissionsService.hasRolePermissionOrAdmin({
            authContext,
            publisherId: role.publisher_id!,
            permission: 'canManageRoles'
        });

        if (!hasPermission) {
            return APIResponse.forbidden(c, "You do not have permission to manage roles");
        }

        // Update role
        await DB.instance()
            .update(DB.Schema.roles)
            .set(updateData)
            .where(eq(DB.Schema.roles.id, roleId));

        return APIResponse.successNoData(c, "Role updated successfully");
    }

    /**
     * Delete a custom role
     */
    static async deleteRole(
        c: Context,
        roleId: number,
        authContext: AuthHandler.AuthContext
    ) {
        const role = await DB.instance()
            .select()
            .from(DB.Schema.roles)
            .where(eq(DB.Schema.roles.id, roleId))
            .get();

        if (!role) {
            return APIResponse.notFound(c, "Role not found");
        }

        // Cannot delete system roles
        if (role.is_system) {
            return APIResponse.forbidden(c, "Cannot delete system roles");
        }

        // Check permission
        const hasPermission = await PermissionsService.hasRolePermissionOrAdmin({
            authContext,
            publisherId: role.publisher_id!,
            permission: 'canManageRoles'
        });

        if (!hasPermission) {
            return APIResponse.forbidden(c, "You do not have permission to manage roles");
        }

        // Check if role is assigned to any users
        const assignments = await DB.instance()
            .select()
            .from(DB.Schema.roleAssignments)
            .where(eq(DB.Schema.roleAssignments.role_id, roleId))
            .limit(1)
            .all();

        if (assignments.length > 0) {
            return APIResponse.badRequest(c, "Cannot delete role that is assigned to users. Remove assignments first.");
        }

        // Delete role
        await DB.instance()
            .delete(DB.Schema.roles)
            .where(eq(DB.Schema.roles.id, roleId));

        return APIResponse.successNoData(c, "Role deleted successfully");
    }

    /**
     * Assign a role to a user
     */
    static async assignRole(
        c: Context,
        publisherId: number,
        assignmentData: PublisherModel.AssignRole.Body,
        authContext: AuthHandler.AuthContext
    ) {
        // Check permission
        const hasPermission = await PermissionsService.hasRolePermissionOrAdmin({
            authContext,
            publisherId,
            groupId: assignmentData.group_id,
            packageId: assignmentData.package_id,
            permission: 'canManageMembers'
        });

        if (!hasPermission) {
            return APIResponse.forbidden(c, "You do not have permission to manage members");
        }

        // Verify role exists and is accessible
        const role = await DB.instance()
            .select()
            .from(DB.Schema.roles)
            .where(eq(DB.Schema.roles.id, assignmentData.role_id))
            .get();

        if (!role) {
            return APIResponse.notFound(c, "Role not found");
        }

        // Verify role is either system role or belongs to this publisher
        if (!role.is_system && role.publisher_id !== publisherId) {
            return APIResponse.forbidden(c, "Cannot assign role from different publisher");
        }

        // Verify user exists
        const user = await DB.instance()
            .select()
            .from(DB.Schema.users)
            .where(eq(DB.Schema.users.id, assignmentData.user_id))
            .get();

        if (!user) {
            return APIResponse.notFound(c, "User not found");
        }

        // Verify group exists if specified
        if (assignmentData.group_id) {
            const group = await DB.instance()
                .select()
                .from(DB.Schema.publisherGroups)
                .where(eq(DB.Schema.publisherGroups.id, assignmentData.group_id))
                .get();

            if (!group || group.publisher_id !== publisherId) {
                return APIResponse.notFound(c, "Group not found");
            }
        }

        // Verify package exists if specified
        if (assignmentData.package_id) {
            const pkg = await DB.instance()
                .select()
                .from(DB.Schema.packages)
                .where(eq(DB.Schema.packages.id, assignmentData.package_id))
                .get();

            if (!pkg || pkg.publisher_id !== publisherId) {
                return APIResponse.notFound(c, "Package not found");
            }
        }

        // Check if user already has a role assignment at this exact scope
        const existing = await DB.instance()
            .select()
            .from(DB.Schema.roleAssignments)
            .where(and(
                eq(DB.Schema.roleAssignments.user_id, assignmentData.user_id),
                eq(DB.Schema.roleAssignments.publisher_id, publisherId),
                assignmentData.group_id
                    ? eq(DB.Schema.roleAssignments.group_id, assignmentData.group_id)
                    : eq(DB.Schema.roleAssignments.group_id, null as any),
                assignmentData.package_id
                    ? eq(DB.Schema.roleAssignments.package_id, assignmentData.package_id)
                    : eq(DB.Schema.roleAssignments.package_id, null as any)
            ))
            .get();

        if (existing) {
            // Update existing assignment
            await DB.instance()
                .update(DB.Schema.roleAssignments)
                .set({
                    role_id: assignmentData.role_id,
                    assigned_by_user_id: authContext.user_id
                })
                .where(eq(DB.Schema.roleAssignments.id, existing.id));

            return APIResponse.successNoData(c, "Role assignment updated successfully");
        }

        // Create new assignment
        await DB.instance()
            .insert(DB.Schema.roleAssignments)
            .values({
                role_id: assignmentData.role_id,
                user_id: assignmentData.user_id,
                publisher_id: publisherId,
                group_id: assignmentData.group_id ?? null,
                package_id: assignmentData.package_id ?? null,
                assigned_by_user_id: authContext.user_id,
            });

        return APIResponse.createdNoData(c, "Role assigned successfully");
    }

    /**
     * Get all role assignments for a scope
     */
    static async getRoleAssignments(
        c: Context,
        publisherId: number,
        groupId?: number,
        packageId?: number
    ) {
        const assignments = await DB.instance()
            .select()
            .from(DB.Schema.roleAssignments)
            .innerJoin(DB.Schema.roles, eq(DB.Schema.roleAssignments.role_id, DB.Schema.roles.id))
            .innerJoin(DB.Schema.users, eq(DB.Schema.roleAssignments.user_id, DB.Schema.users.id))
            .where(and(
                eq(DB.Schema.roleAssignments.publisher_id, publisherId),
                groupId !== undefined
                    ? eq(DB.Schema.roleAssignments.group_id, groupId)
                    : eq(DB.Schema.roleAssignments.group_id, null as any),
                packageId !== undefined
                    ? eq(DB.Schema.roleAssignments.package_id, packageId)
                    : eq(DB.Schema.roleAssignments.package_id, null as any)
            ))
            .all();

        const formattedAssignments = assignments.map(a => ({
            ...a.role_assignments,
            role: a.roles,
            user: {
                id: a.users.id,
                username: a.users.username,
                display_name: a.users.display_name,
                email: a.users.email,
            }
        }));

        return APIResponse.success(c, "Role assignments retrieved successfully", formattedAssignments);
    }

    /**
     * Remove a role assignment
     */
    static async removeRoleAssignment(
        c: Context,
        assignmentId: number,
        authContext: AuthHandler.AuthContext
    ) {
        const assignment = await DB.instance()
            .select()
            .from(DB.Schema.roleAssignments)
            .where(eq(DB.Schema.roleAssignments.id, assignmentId))
            .get();

        if (!assignment) {
            return APIResponse.notFound(c, "Role assignment not found");
        }

        // Check permission
        const hasPermission = await PermissionsService.hasRolePermissionOrAdmin({
            authContext,
            publisherId: assignment.publisher_id,
            groupId: assignment.group_id ?? undefined,
            packageId: assignment.package_id ?? undefined,
            permission: 'canManageMembers'
        });

        if (!hasPermission) {
            return APIResponse.forbidden(c, "You do not have permission to manage members");
        }

        // Check if this is the last owner assignment at publisher level
        if (assignment.group_id === null && assignment.package_id === null) {
            const role = await DB.instance()
                .select()
                .from(DB.Schema.roles)
                .where(eq(DB.Schema.roles.id, assignment.role_id))
                .get();

            if (role?.name === 'owner') {
                const ownerCount = await DB.instance()
                    .select()
                    .from(DB.Schema.roleAssignments)
                    .innerJoin(DB.Schema.roles, eq(DB.Schema.roleAssignments.role_id, DB.Schema.roles.id))
                    .where(and(
                        eq(DB.Schema.roleAssignments.publisher_id, assignment.publisher_id),
                        eq(DB.Schema.roleAssignments.group_id, null as any),
                        eq(DB.Schema.roleAssignments.package_id, null as any),
                        eq(DB.Schema.roles.name, 'owner')
                    ))
                    .all();

                if (ownerCount.length <= 1) {
                    return APIResponse.badRequest(c, "Cannot remove the last owner. Assign another owner first.");
                }
            }
        }

        // Remove assignment
        await DB.instance()
            .delete(DB.Schema.roleAssignments)
            .where(eq(DB.Schema.roleAssignments.id, assignmentId));

        return APIResponse.successNoData(c, "Role assignment removed successfully");
    }

    /**
     * Get role assignments for a specific user
     */
    static async getUserRoleAssignments(
        c: Context,
        userId: number,
        publisherId?: number
    ) {
        const conditions = [eq(DB.Schema.roleAssignments.user_id, userId)];
        
        if (publisherId !== undefined) {
            conditions.push(eq(DB.Schema.roleAssignments.publisher_id, publisherId));
        }

        const assignments = await DB.instance()
            .select()
            .from(DB.Schema.roleAssignments)
            .innerJoin(DB.Schema.roles, eq(DB.Schema.roleAssignments.role_id, DB.Schema.roles.id))
            .innerJoin(DB.Schema.publishers, eq(DB.Schema.roleAssignments.publisher_id, DB.Schema.publishers.id))
            .where(and(...conditions))
            .all();

        const formattedAssignments = assignments.map(a => ({
            ...a.role_assignments,
            role: a.roles,
            publisher: {
                id: a.publishers.id,
                name: a.publishers.name,
                display_name: a.publishers.display_name,
            }
        }));

        return APIResponse.success(c, "User role assignments retrieved successfully", formattedAssignments);
    }
}
