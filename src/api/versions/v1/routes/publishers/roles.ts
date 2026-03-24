import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import z from "zod";
import { DB } from "../../../../../db";
import { eq } from "drizzle-orm";
import { APIResponse } from "../../../../utils/api-res";
import { APIRouteSpec, APIResponseSpec } from "../../../../utils/specHelpers";
import { PublisherModel } from "../../../../utils/shared-models/publisher";
import { AuthHandler } from "../../../../utils/authHandler";
import { RolesService } from "../../../../utils/services/roles";
import { DOCS_TAGS } from "../../docs";

const router = new Hono().basePath('/roles');


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
            .from(DB.Tables.publishers)
            .where(eq(DB.Tables.publishers.name, publisherName))
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
            .from(DB.Tables.publishers)
            .where(eq(DB.Tables.publishers.name, publisherName))
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
