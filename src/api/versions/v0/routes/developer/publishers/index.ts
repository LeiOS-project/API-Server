import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { PublisherModel } from "../../../../../utils/shared-models/publisher";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { PublishersService } from "../../../../../utils/services/publishers";
import { DOCS_TAGS } from "../../../docs";
import { AuthHandler } from "../../../../../utils/authHandler";
import { router as groupsRouter } from "./groups";
import { router as membersRouter } from "./members";
import { router as packagesRouter } from "./packages";
import rolesRouter from "./roles";

export const router = new Hono().basePath('/publishers');

// List all publishers
router.get('/',

    APIRouteSpec.unauthenticated({
        summary: "List publishers",
        description: "Retrieve a list of all public publishers. Authenticated users see publishers they're members of.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Publishers retrieved successfully", PublisherModel.GetAllPublishers.Response)
        )
    }),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext | undefined;
        
        return await PublishersService.getAllPublishers(c, {
            includePrivate: authContext !== undefined,
            userId: authContext?.user_id
        });
    }
);

// Create a new publisher
router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create publisher",
        description: "Create a new publisher (organization/group). Creator becomes the owner.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS],
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.createdNoData("Publisher created successfully"),
            APIResponseSpec.conflict("Publisher with this name already exists")
        )
    }),

    zValidator("json", PublisherModel.CreatePublisher.Body),

    async (c) => {
        const publisherData = c.req.valid("json");
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        return await PublishersService.createPublisher(c, publisherData, authContext);
    }
);

// Get specific publisher by name
router.get('/:publisherName',

    APIRouteSpec.unauthenticated({
        summary: "Get publisher",
        description: "Retrieve details of a specific publisher.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Publisher retrieved successfully", PublisherModel.GetPublisher.Response),
            APIResponseSpec.notFound("Publisher not found"),
            APIResponseSpec.forbidden("Publisher is private")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string()
    })),

    async (c) => {
        // @ts-ignore
        const { publisherName } = c.req.valid("param") as { publisherName: string };
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext | undefined;

        return await PublishersService.getPublisher(c, publisherName, authContext?.user_id);
    }
);

// Update publisher
router.put('/:publisherName',

    APIRouteSpec.authenticated({
        summary: "Update publisher",
        description: "Update publisher details. Requires owner or maintainer role.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS],
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Publisher updated successfully"),
            APIResponseSpec.notFound("Publisher not found"),
            APIResponseSpec.forbidden("You do not have permission to update this publisher")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string()
    })),
    zValidator("json", PublisherModel.UpdatePublisher.Body),

    async (c) => {
        // @ts-ignore
        const { publisherName } = c.req.valid("param") as { publisherName: string };
        const updateData = c.req.valid("json");
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

        // Check visibility
        if (publisher.visibility === 'private') {
            const { PermissionsService } = await import("../../../../../utils/services/permissions");
            const isMember = await PermissionsService.isMember({
                userId: authContext.user_id,
                publisherId: publisher.id
            });
            if (!isMember && authContext.user_role !== 'admin') {
                return APIResponse.forbidden(c, "You do not have access to this publisher");
            }
        }

        return await PublishersService.updatePublisher(c, publisher.id, updateData, authContext);
    }
);

// Delete publisher
router.delete('/:publisherName',

    APIRouteSpec.authenticated({
        summary: "Delete publisher",
        description: "Delete a publisher. Only owners can delete. Publisher must have no packages.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Publisher deleted successfully"),
            APIResponseSpec.notFound("Publisher not found"),
            APIResponseSpec.forbidden("Only owners can delete publishers"),
            APIResponseSpec.badRequest("Cannot delete publisher with existing packages")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string()
    })),

    async (c) => {
        // @ts-ignore
        const { publisherName } = c.req.valid("param") as { publisherName: string };
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

        // Check visibility
        if (publisher.visibility === 'private') {
            const { PermissionsService } = await import("../../../../../utils/services/permissions");
            const isMember = await PermissionsService.isMember({
                userId: authContext.user_id,
                publisherId: publisher.id
            });
            if (!isMember && authContext.user_role !== 'admin') {
                return APIResponse.forbidden(c, "You do not have access to this publisher");
            }
        }

        return await PublishersService.deletePublisher(c, publisher.id, authContext);
    }
);

// Mount sub-routes
router.route('/:publisherName/roles', rolesRouter);
router.route('/:publisherName', groupsRouter);
router.route('/:publisherName', membersRouter);
router.route('/:publisherName', packagesRouter);
