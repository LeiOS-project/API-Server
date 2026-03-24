import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { PublisherModel } from "../../../../../utils/shared-models/publisher";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { PublishersService } from "../../../../../utils/services/publishers";
import { DOCS_TAGS } from "../../../docs";
import { AuthHandler } from "../../../../../utils/authHandler";
import { APIResponse } from "../../../../../utils/api-res";
import { DB } from "../../../../../../db";
import { eq } from "drizzle-orm";

export const router = new Hono().basePath('/members');

// List members
router.get('/',

    APIRouteSpec.authenticated({
        summary: "List members",
        description: "Retrieve all members of a publisher or group.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_MEMBERS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Members retrieved successfully", PublisherModel.GetAllMembers.Response)
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string()
    })),

    zValidator("query", z.object({
        groupId: z.coerce.number().optional()
    })),

    async (c) => {
        // @ts-ignore
        const { publisherName } = c.req.valid("param") as { publisherName: string };
        const { groupId } = c.req.valid("query");

        // Get publisher
        const publisher = await DB.instance()
            .select()
            .from(DB.Tables.publishers)
            .where(eq(DB.Tables.publishers.name, publisherName))
            .get();

        if (!publisher) {
            return APIResponse.notFound(c, "Publisher not found");
        }

        return await PublishersService.getMembers(c, publisher.id, groupId);
    }
);

// Add member
router.post('/',

    APIRouteSpec.authenticated({
        summary: "Add member",
        description: "Add a new member to publisher or group with specific role and permissions.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_MEMBERS],
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.createdNoData("Member added successfully"),
            APIResponseSpec.conflict("User is already a member"),
            APIResponseSpec.forbidden("You do not have permission to manage members"),
            APIResponseSpec.notFound("User not found")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string()
    })),

    zValidator("json", PublisherModel.AddMember.Body),

    async (c) => {
        // @ts-ignore
        const { publisherName } = c.req.valid("param") as { publisherName: string };
        const memberData = c.req.valid("json");
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

        return await PublishersService.addMember(c, publisher.id, memberData, authContext);
    }
);

// Get specific member
router.get('/:memberId',

    APIRouteSpec.authenticated({
        summary: "Get member",
        description: "Retrieve details of a specific member.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_MEMBERS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Member retrieved successfully", PublisherModel.GetMember.Response),
            APIResponseSpec.notFound("Member not found")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string(),
        memberId: z.coerce.number()
    })),

    async (c) => {
        // @ts-ignore
        const { memberId } = c.req.valid("param") as { memberId: number };

        const member = await DB.instance()
            .select()
            .from(DB.Tables.publisherMembers)
            .where(eq(DB.Tables.publisherMembers.id, memberId))
            .get();

        if (!member) {
            return APIResponse.notFound(c, "Member not found");
        }

        return APIResponse.success(c, "Member retrieved successfully", member);
    }
);

// Update member role/permissions
router.put('/:memberId',

    APIRouteSpec.authenticated({
        summary: "Update member",
        description: "Update member's role or permissions. Requires canManageMembers permission.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_MEMBERS],
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Member updated successfully"),
            APIResponseSpec.notFound("Member not found"),
            APIResponseSpec.forbidden("You do not have permission to manage members")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string(),
        memberId: z.coerce.number()
    })),

    zValidator("json", PublisherModel.UpdateMember.Body),

    async (c) => {
        // @ts-ignore
        const { memberId } = c.req.valid("param") as { memberId: number };
        const updateData = c.req.valid("json");
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        const member = await DB.instance()
            .select()
            .from(DB.Tables.publisherMembers)
            .where(eq(DB.Tables.publisherMembers.id, memberId))
            .get();

        if (!member) {
            return APIResponse.notFound(c, "Member not found");
        }

        // Check permission
        const { PermissionsService } = await import("../../../../../utils/services/permissions");
        const hasPermission = await PermissionsService.hasPermissionOrAdmin({
            authContext,
            publisherId: member.publisher_id,
            groupId: member.group_id ?? undefined,
            permission: 'canManageMembers'
        });

        if (!hasPermission) {
            return APIResponse.forbidden(c, "You do not have permission to manage members");
        }

        // Build update object
        const updates: any = {};
        if (updateData.role) {
            updates.role = updateData.role;
            // Merge with default permissions for new role
            const defaultPerms = PermissionsService.getPermissionsForRole(updateData.role);
            updates.permissions = {
                ...defaultPerms,
                ...(updateData.permissions || {})
            };
        } else if (updateData.permissions) {
            // Just update permissions
            updates.permissions = {
                ...member.permissions,
                ...updateData.permissions
            };
        }

        await DB.instance()
            .update(DB.Tables.publisherMembers)
            .set(updates)
            .where(eq(DB.Tables.publisherMembers.id, memberId));

        return APIResponse.successNoData(c, "Member updated successfully");
    }
);

// Remove member
router.delete('/:memberId',

    APIRouteSpec.authenticated({
        summary: "Remove member",
        description: "Remove a member from publisher or group.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_MEMBERS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Member removed successfully"),
            APIResponseSpec.notFound("Member not found"),
            APIResponseSpec.forbidden("You do not have permission to manage members"),
            APIResponseSpec.badRequest("Cannot remove the last owner")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string(),
        memberId: z.coerce.number()
    })),

    async (c) => {
        // @ts-ignore
        const { memberId } = c.req.valid("param") as { memberId: number };
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        const member = await DB.instance()
            .select()
            .from(DB.Tables.publisherMembers)
            .where(eq(DB.Tables.publisherMembers.id, memberId))
            .get();

        if (!member) {
            return APIResponse.notFound(c, "Member not found");
        }

        return await PublishersService.removeMember(c, member.publisher_id, memberId, authContext);
    }
);
