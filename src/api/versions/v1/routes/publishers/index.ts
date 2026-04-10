import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { and, eq, ilike, or, SQL } from "drizzle-orm";
import { DB } from "../../../../../db";
import { APIResponse } from "../../../../utils/api-res";
import { PublisherModel } from "./model";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { AuthHandler } from "../../../../utils/authHandler";
import { router as membersRouter } from "./members";
import rolesRouter from "./roles";
import { Utils } from "../../../../../utils";
import { de, id } from "zod/locales";

export const router = new Hono().basePath('/publishers');

// List all publishers
router.get('/',

    APIRouteSpec.unauthenticated({

        summary: "List publishers",
        description: "Retrieve a list of all publishers matching the search criteria.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Publishers retrieved successfully", PublisherModel.GetAll.Response)
        )
    }),

    zValidator("query", PublisherModel.GetAll.Query),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        const { limit, offset, searchString, onlyMembershipByMe } = c.req.valid("query");

        if (onlyMembershipByMe && authContext.type === "unauthenticated") {
            return APIResponse.success(c, "No publishers found", []);
        }

        let query = DB.instance()
            .select({
                id: DB.Tables.publishers.id,

                name: DB.Tables.publishers.name,
                display_name: DB.Tables.publishers.display_name,
                description: DB.Tables.publishers.description,
                homepage_url: DB.Tables.publishers.homepage_url,
                
                created_at: DB.Tables.publishers.created_at,
            })
            .from(DB.Tables.publishers)
            .$dynamic();

        if (onlyMembershipByMe && authContext.type !== "unauthenticated") {
            query = query.innerJoin(
                DB.Tables.publisherMembers,
                and(
                    eq(DB.Tables.publisherMembers.publisher_id, DB.Tables.publishers.id),
                    eq(DB.Tables.publisherMembers.user_id, authContext.user_id)
                )
            );
        }

        const filters: Array<SQL<unknown> | undefined> = [];

        if (searchString) {
            filters.push(
                or(
                    ilike(DB.Tables.publishers.name, `%${searchString}%`),
                    ilike(DB.Tables.publishers.display_name, `%${searchString}%`)
                )
            );
        }

        const results = await query
            .where(filters.length > 0 ? and(...filters) : undefined)
            .limit(limit)
            .offset(offset);

        return APIResponse.success(c, "Publishers retrieved successfully", results satisfies PublisherModel.GetAll.Response);
    }
);

// Create a new publisher
router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create publisher",
        description: "Create a new publisher. Creator becomes the owner.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.createdNoData("Publisher created successfully"),
            APIResponseSpec.conflict("Publisher with this name already exists"),
            APIResponseSpec.unauthorized("Authentication required")
        )
    }),

    zValidator("json", PublisherModel.CreatePublisher.Body),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        if (authContext.type === "unauthenticated") {
            return APIResponse.unauthorized(c, "Authentication required");
        }

        const publisherData = c.req.valid("json");

        // Check if publisher name already exists
        const existing = await DB.instance()
            .select()
            .from(DB.Tables.publishers)
            .where(eq(DB.Tables.publishers.name, publisherData.name))
            .get();

        if (existing) {
            return APIResponse.conflict(c, "Publisher with this name already exists");
        }

        const publisher = await DB.instance().transaction(async (tx) => {

            const publisher = await tx.insert(DB.Tables.publishers).values({
                name: publisherData.name,
                
                display_name: publisherData.display_name,
                description: publisherData.description,
                homepage_url: publisherData.homepage_url,

                owner_user_id: authContext.user_id
            }).returning().get();

            await tx.insert(DB.Tables.publisherMembers).values({
                publisher_id: publisher.id,
                user_id: authContext.user_id,
                role: 'owner',
                is_publicly_hidden: false
            });

            return publisher;
        });

        return APIResponse.created(c, "Publisher created successfully", { id: publisher.id });
    }
);


router.use('/:publisherName/*',

    zValidator("param", z.object({
        publisherName: PublisherModel.PublisherNameSchema
    })),

    async (c, next) => {
        // @ts-ignore
        const { publisherName } = c.req.valid("param") as { publisherName: string };

        // Get publisher
        const publisher = await DB.instance()
            .select()
            .from(DB.Tables.publishers)
            .where(eq(DB.Tables.publishers.name, publisherName))
            .get();

        if (!publisher) {
            return APIResponse.notFound(c, "Publisher not found");
        }

        // @ts-ignore
        c.set("publisher", publisher);

        return await next();
    }
);

router.get('/:publisherName',

    APIRouteSpec.unauthenticated({
        summary: "Get publisher",
        description: "Retrieve details of a specific publisher.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Publisher retrieved successfully", PublisherModel.GetPublisherByName.Response),
            APIResponseSpec.notFound("Publisher not found"),
        )
    }),

    async (c) => {
        // @ts-ignore
        const publisher = c.get("publisher") as DB.Models.Publisher;

        const returnPublisher = {
            id: publisher.id,

            name: publisher.name,
            display_name: publisher.display_name,
            description: publisher.description,
            homepage_url: publisher.homepage_url,

            created_at: publisher.created_at,
        }

        return APIResponse.success(c, "Publisher retrieved successfully", Utils.asExact<PublisherModel.GetPublisherByName.Response>()(returnPublisher));
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
            const { PermissionsService } = await import("../../../../utils/services/permissions");
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
            const { PermissionsService } = await import("../../../../utils/services/permissions");
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
