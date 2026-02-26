import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { PublisherModel } from "../../../utils/shared-models/publisher";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { PublishersService } from "../../../utils/services/publishers";
import { DOCS_TAGS } from "../../../docs";
import { AuthHandler } from "../../../utils/authHandler";
import { APIResponse } from "../../../utils/api-res";
import { DB } from "../../../../db";
import { eq } from "drizzle-orm";

export const router = new Hono().basePath('/groups');

// List groups in publisher
router.get('/',

    APIRouteSpec.authenticated({
        summary: "List groups",
        description: "Retrieve all groups (and subgroups) within a publisher.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_GROUPS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Groups retrieved successfully", PublisherModel.GetAllGroups.Response)
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string()
    })),

    zValidator("query", z.object({
        parentGroupId: z.coerce.number().optional()
    })),

    async (c) => {
        // @ts-ignore
        const { publisherName } = c.req.valid("param") as { publisherName: string };
        const { parentGroupId } = c.req.valid("query");

        // Get publisher
        const publisher = await DB.instance()
            .select()
            .from(DB.Schema.publishers)
            .where(eq(DB.Schema.publishers.name, publisherName))
            .get();

        if (!publisher) {
            return APIResponse.notFound(c, "Publisher not found");
        }

        return await PublishersService.getGroups(c, publisher.id, parentGroupId);
    }
);

// Create a new group
router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create group",
        description: "Create a new subgroup within the publisher.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_GROUPS],
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.createdNoData("Group created successfully"),
            APIResponseSpec.conflict("Group with this name already exists"),
            APIResponseSpec.forbidden("You do not have permission to create groups")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string()
    })),

    zValidator("json", PublisherModel.CreateGroup.Body),

    async (c) => {
        // @ts-ignore
        const { publisherName } = c.req.valid("param") as { publisherName: string };
        const groupData = c.req.valid("json");
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

        return await PublishersService.createGroup(c, publisher.id, groupData, authContext);
    }
);

// Get specific group
router.get('/:groupId',

    APIRouteSpec.authenticated({
        summary: "Get group",
        description: "Retrieve details of a specific group.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_GROUPS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Group retrieved successfully", PublisherModel.GetGroup.Response),
            APIResponseSpec.notFound("Group not found")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string(),
        groupId: z.coerce.number()
    })),

    async (c) => {
        // @ts-ignore
        const { groupId } = c.req.valid("param") as { groupId: number };

        const group = await DB.instance()
            .select()
            .from(DB.Schema.publisherGroups)
            .where(eq(DB.Schema.publisherGroups.id, groupId))
            .get();

        if (!group) {
            return APIResponse.notFound(c, "Group not found");
        }

        return APIResponse.success(c, "Group retrieved successfully", group);
    }
);

// Update group
router.put('/:groupId',

    APIRouteSpec.authenticated({
        summary: "Update group",
        description: "Update group details. Requires canCreateGroups permission.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_GROUPS],
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Group updated successfully"),
            APIResponseSpec.notFound("Group not found"),
            APIResponseSpec.forbidden("You do not have permission to update groups")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string(),
        groupId: z.coerce.number()
    })),

    zValidator("json", PublisherModel.UpdateGroup.Body),

    async (c) => {
        // @ts-ignore
        const { groupId } = c.req.valid("param") as { groupId: number };
        const updateData = c.req.valid("json");
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        const group = await DB.instance()
            .select()
            .from(DB.Schema.publisherGroups)
            .where(eq(DB.Schema.publisherGroups.id, groupId))
            .get();

        if (!group) {
            return APIResponse.notFound(c, "Group not found");
        }

        // Check permission
        const { PermissionsService } = await import("../../../utils/services/permissions");
        const hasPermission = await PermissionsService.hasPermissionOrAdmin({
            authContext,
            publisherId: group.publisher_id,
            groupId: group.parent_group_id ?? undefined,
            permission: 'canCreateGroups'
        });

        if (!hasPermission) {
            return APIResponse.forbidden(c, "You do not have permission to update groups");
        }

        await DB.instance()
            .update(DB.Schema.publisherGroups)
            .set(updateData)
            .where(eq(DB.Schema.publisherGroups.id, groupId));

        return APIResponse.successNoData(c, "Group updated successfully");
    }
);

// Delete group
router.delete('/:groupId',

    APIRouteSpec.authenticated({
        summary: "Delete group",
        description: "Delete a group. Group must have no packages or subgroups.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_GROUPS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Group deleted successfully"),
            APIResponseSpec.notFound("Group not found"),
            APIResponseSpec.forbidden("You do not have permission to delete groups"),
            APIResponseSpec.badRequest("Cannot delete group with packages or subgroups")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string(),
        groupId: z.coerce.number()
    })),

    async (c) => {
        // @ts-ignore
        const { groupId } = c.req.valid("param") as { groupId: number };
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        const group = await DB.instance()
            .select()
            .from(DB.Schema.publisherGroups)
            .where(eq(DB.Schema.publisherGroups.id, groupId))
            .get();

        if (!group) {
            return APIResponse.notFound(c, "Group not found");
        }

        // Check permission
        const { PermissionsService } = await import("../../../utils/services/permissions");
        const hasPermission = await PermissionsService.hasPermissionOrAdmin({
            authContext,
            publisherId: group.publisher_id,
            groupId: group.parent_group_id ?? undefined,
            permission: 'canCreateGroups'
        });

        if (!hasPermission) {
            return APIResponse.forbidden(c, "You do not have permission to delete groups");
        }

        // Check if group has packages
        const packages = await DB.instance()
            .select()
            .from(DB.Schema.packages)
            .where(eq(DB.Schema.packages.group_id, groupId))
            .limit(1)
            .all();

        if (packages.length > 0) {
            return APIResponse.badRequest(c, "Cannot delete group with existing packages");
        }

        // Check if group has subgroups
        const subgroups = await DB.instance()
            .select()
            .from(DB.Schema.publisherGroups)
            .where(eq(DB.Schema.publisherGroups.parent_group_id, groupId))
            .limit(1)
            .all();

        if (subgroups.length > 0) {
            return APIResponse.badRequest(c, "Cannot delete group with existing subgroups");
        }

        // Delete group
        await DB.instance()
            .delete(DB.Schema.publisherGroups)
            .where(eq(DB.Schema.publisherGroups.id, groupId));

        return APIResponse.successNoData(c, "Group deleted successfully");
    }
);
