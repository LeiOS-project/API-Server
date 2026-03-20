import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import z from "zod";
import { DB } from "../../../../../../db";
import { eq } from "drizzle-orm";
import { APIResponse } from "../../../../../utils/api-res";
import { APIRouteSpec, APIResponseSpec } from "../../../../../utils/specHelpers";
import { PublisherModel } from "../../../../../utils/shared-models/publisher";
import { AuthHandler } from "../../../../../utils/authHandler";
import { RolesService } from "../../../../../utils/services/roles";
import { DOCS_TAGS } from "../../../docs";

const router = new Hono().basePath('/roles');

// ==================== ROLES ====================

// Get all roles for a publisher
router.get('/',
    APIRouteSpec.unauthenticated({
        summary: "Get all roles",
        description: "Get all roles for a publisher (including system roles).",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_ROLES],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Roles retrieved successfully", PublisherModel.GetAllRoles.Response),
            APIResponseSpec.notFound("Publisher not found")
        )
    }),
    zValidator("param", z.object({
        publisherName: z.string()
    })),
    async (c) => {
        // @ts-ignore
        const { publisherName } = c.req.valid("param") as { publisherName: string };

        // Get publisher
        const publisher = await DB.instance()
            .select()
            .from(DB.Schema.publishers)
            .where(eq(DB.Schema.publishers.name, publisherName))
            .get();

        if (!publisher) {
            return APIResponse.notFound(c, "Publisher not found");
        }

        return await RolesService.getRoles(c, publisher.id);
    }
);

// Create a new role
router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create role",
        description: "Create a custom role for a publisher. Requires canManageRoles permission.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_ROLES],
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.created("Role created successfully", z.object({ id: z.number() })),
            APIResponseSpec.conflict("Role with this name already exists"),
            APIResponseSpec.forbidden("You do not have permission to manage roles"),
            APIResponseSpec.notFound("Publisher not found")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string()
    })),

    zValidator("json", PublisherModel.CreateRole.Body),
    
    async (c) => {
        // @ts-ignore
        const { publisherName } = c.req.valid("param") as { publisherName: string };
        const roleData = c.req.valid("json");
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        // Get publisher
        const publisher = await DB.instance()
            .select()
            .from(DB.Schema.publishers)
            .where(eq(DB.Schema.publishers.name, publisherName))
            .get();

        if (!publisher) {
            return APIResponse.notFound(c, "Publisher not found");
        }

        return await RolesService.createRole(c, publisher.id, roleData, authContext);
    }
);

// Get specific role
router.get('/:roleId',
    APIRouteSpec.unauthenticated({
        summary: "Get role",
        description: "Get details of a specific role.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_ROLES],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Role retrieved successfully", PublisherModel.GetRole.Response),
            APIResponseSpec.notFound("Role not found")
        )
    }),
    zValidator("param", z.object({
        publisherName: z.string(),
        roleId: z.coerce.number()
    })),
    async (c) => {
        // @ts-ignore
        const { roleId } = c.req.valid("param") as { roleId: number };

        return await RolesService.getRole(c, roleId);
    }
);

// Update a role
router.put('/:roleId',
    APIRouteSpec.authenticated({
        summary: "Update role",
        description: "Update a custom role. Cannot update system roles. Requires canManageRoles permission.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_ROLES],
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Role updated successfully"),
            APIResponseSpec.notFound("Role not found"),
            APIResponseSpec.forbidden("Cannot update system roles or insufficient permissions")
        )
    }),
    zValidator("param", z.object({
        publisherName: z.string(),
        roleId: z.coerce.number()
    })),
    zValidator("json", PublisherModel.UpdateRole.Body),
    async (c) => {
        // @ts-ignore
        const { roleId } = c.req.valid("param") as { roleId: number };
        const updateData = c.req.valid("json");
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        return await RolesService.updateRole(c, roleId, updateData, authContext);
    }
);

// Delete a role
router.delete('/:roleId',
    APIRouteSpec.authenticated({
        summary: "Delete role",
        description: "Delete a custom role. Cannot delete system roles or roles with assignments. Requires canManageRoles permission.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_ROLES],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Role deleted successfully"),
            APIResponseSpec.notFound("Role not found"),
            APIResponseSpec.forbidden("Cannot delete system roles or insufficient permissions"),
            APIResponseSpec.badRequest("Cannot delete role with active assignments")
        )
    }),
    zValidator("param", z.object({
        publisherName: z.string(),
        roleId: z.coerce.number()
    })),
    async (c) => {
        // @ts-ignore
        const { roleId } = c.req.valid("param") as { roleId: number };
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        return await RolesService.deleteRole(c, roleId, authContext);
    }
);

// ==================== ROLE ASSIGNMENTS ====================

// Get all role assignments for a scope
router.get('/:scope/assignments',
    APIRouteSpec.authenticated({
        summary: "Get role assignments",
        description: "Get all role assignments for a publisher, group, or package.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_ROLES],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Role assignments retrieved successfully", PublisherModel.GetAllRoleAssignments.Response),
            APIResponseSpec.notFound("Publisher not found")
        )
    }),
    zValidator("param", z.object({
        publisherName: z.string(),
        scope: z.enum(['publisher', 'group', 'package'])
    })),
    zValidator("query", z.object({
        groupId: z.coerce.number().optional(),
        packageId: z.coerce.number().optional()
    })),
    async (c) => {
        // @ts-ignore
        const { publisherName, scope } = c.req.valid("param") as { publisherName: string, scope: string };
        const { groupId, packageId } = c.req.valid("query");

        // Get publisher
        const publisher = await DB.instance()
            .select()
            .from(DB.Schema.publishers)
            .where(eq(DB.Schema.publishers.name, publisherName))
            .get();

        if (!publisher) {
            return APIResponse.notFound(c, "Publisher not found");
        }

        return await RolesService.getRoleAssignments(c, publisher.id, groupId, packageId);
    }
);

// Assign a role
router.post('/assignments',
    APIRouteSpec.authenticated({
        summary: "Assign role",
        description: "Assign a role to a user at publisher, group, or package level. Requires canManageMembers permission.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_ROLES],
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.createdNoData("Role assigned successfully"),
            APIResponseSpec.notFound("Role, user, group, or package not found"),
            APIResponseSpec.forbidden("Insufficient permissions or invalid role"),
            APIResponseSpec.notFound("Publisher not found")
        )
    }),
    zValidator("param", z.object({
        publisherName: z.string()
    })),
    zValidator("json", PublisherModel.AssignRole.Body),
    async (c) => {
        // @ts-ignore
        const { publisherName } = c.req.valid("param") as { publisherName: string };
        const assignmentData = c.req.valid("json");
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        // Get publisher
        const publisher = await DB.instance()
            .select()
            .from(DB.Schema.publishers)
            .where(eq(DB.Schema.publishers.name, publisherName))
            .get();

        if (!publisher) {
            return APIResponse.notFound(c, "Publisher not found");
        }

        return await RolesService.assignRole(c, publisher.id, assignmentData, authContext);
    }
);

// Remove a role assignment
router.delete('/assignments/:assignmentId',
    APIRouteSpec.authenticated({
        summary: "Remove role assignment",
        description: "Remove a role assignment. Requires canManageMembers permission. Cannot remove last owner.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_ROLES],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Role assignment removed successfully"),
            APIResponseSpec.notFound("Role assignment not found"),
            APIResponseSpec.forbidden("Insufficient permissions"),
            APIResponseSpec.badRequest("Cannot remove last owner")
        )
    }),
    zValidator("param", z.object({
        publisherName: z.string(),
        assignmentId: z.coerce.number()
    })),
    async (c) => {
        // @ts-ignore
        const { assignmentId } = c.req.valid("param") as { assignmentId: number };
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        return await RolesService.removeRoleAssignment(c, assignmentId, authContext);
    }
);

export default router;
