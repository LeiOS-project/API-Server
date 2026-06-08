import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { and, eq, like, or, SQL } from "drizzle-orm";
import { DB } from "../../../../../db";
import { APIResponse } from "../../../../utils/api-res";
import { PublisherModel } from "./model";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { AuthHandler } from "../../../../utils/authHandler";
import { PermissionHelper } from "../../../../../utils/permission-helper";
import { router as membersRouter } from "./members";
import { Utils } from "../../../../../utils";

export const router = new Hono().basePath('/publishers');

// List all publishers
router.get('/',

    APIRouteSpec.unauthenticated({

        summary: "List publishers",
        description: "Retrieve a list of all publishers matching the search criteria.",
        tags: [DOCS_TAGS.PUBLISHERS],

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
            return APIResponse.success(c, "Publishers retrieved successfully", []);
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
                    like(DB.Tables.publishers.name, `%${searchString}%`),
                    like(DB.Tables.publishers.display_name, `%${searchString}%`)
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
        tags: [DOCS_TAGS.PUBLISHERS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.created("Publisher created successfully", PublisherModel.CreatePublisher.Response),
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
                role: PermissionHelper.OrgRoles.ADMIN,
                is_publicly_hidden: false
            });

            return publisher;
        });

        return APIResponse.created(c, "Publisher created successfully", { id: publisher.id } satisfies PublisherModel.CreatePublisher.Response);
    }
);


// Loads the publisher by :publisherName into c.set("publisher", ...) for all sub-routes.
// Permission checks happen per-route, not here — a GET needs no membership while a DELETE requires ownership.
router.use('/:publisherName/*',

    zValidator("param", z.object({
        publisherName: PublisherModel.SelectPublisherNameSchema
    })),

    async (c, next) => {
        // @ts-ignore
        const { publisherName } = c.req.valid("param") as { publisherName: string };

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
        tags: [DOCS_TAGS.PUBLISHERS],

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
        };

        return APIResponse.success(c, "Publisher retrieved successfully", Utils.asExact<PublisherModel.GetPublisherByName.Response>()(returnPublisher));
    }
);

// Update publisher
router.put('/:publisherName',

    APIRouteSpec.authenticated({
        summary: "Update publisher",
        description: "Update publisher details. Requires publisher.update permission.",
        tags: [DOCS_TAGS.PUBLISHERS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Publisher updated successfully"),
            APIResponseSpec.notFound("Publisher not found"),
            APIResponseSpec.forbidden("You do not have permission to update this publisher")
        )
    }),

    zValidator("json", PublisherModel.UpdatePublisher.Body),

    async (c) => {
        // @ts-ignore
        const publisher = c.get("publisher") as DB.Models.Publisher;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        const updateData = c.req.valid("json");

        const allowed = await PermissionHelper.can({
            authContext,
            publisher,
            check: (p) => p.publisher.update
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to update this publisher");
        }

        await DB.instance()
            .update(DB.Tables.publishers)
            .set(updateData)
            .where(eq(DB.Tables.publishers.id, publisher.id));

        return APIResponse.successNoData(c, "Publisher updated successfully");
    }
);

// Transfer ownership of a publisher to another user.
router.post('/:publisherName/transfer-ownership',

    APIRouteSpec.authenticated({
        summary: "Transfer publisher ownership",
        description: "Transfer ownership of a publisher to another user. Only the current owner (or site admin) can perform this action.",
        tags: [DOCS_TAGS.PUBLISHERS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Publisher ownership transferred successfully"),
            APIResponseSpec.notFound("Publisher not found"),
            APIResponseSpec.forbidden("Only the current owner can transfer ownership")
        )
    }),

    zValidator("json", PublisherModel.TransferOwnership.Body),

    async (c) => {
        // @ts-ignore
        const publisher = c.get("publisher") as DB.Models.Publisher;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        const { new_owner_user_id } = c.req.valid("json");

        if (authContext.type === "unauthenticated") {
            return APIResponse.unauthorized(c, "Authentication required");
        }

        const isOwner = publisher.owner_user_id === authContext.user_id;

        if (!isOwner && authContext.user_role !== 'admin') {
            return APIResponse.forbidden(c, "Only the current owner can transfer ownership");
        }

        const newOwner = await DB.instance()
            .select({ id: DB.Tables.users.id })
            .from(DB.Tables.users)
            .where(eq(DB.Tables.users.id, new_owner_user_id))
            .get();

        if (!newOwner) {
            return APIResponse.notFound(c, "New owner user not found");
        }

        await DB.instance().transaction(async (tx) => {
            await tx.update(DB.Tables.publishers).set({
                owner_user_id: new_owner_user_id
            }).where(eq(DB.Tables.publishers.id, publisher.id));

            const existingMembership = await tx.select()
                .from(DB.Tables.publisherMembers)
                .where(and(
                    eq(DB.Tables.publisherMembers.publisher_id, publisher.id),
                    eq(DB.Tables.publisherMembers.user_id, new_owner_user_id)
                ))
                .get();

            if (existingMembership) {
                await tx.update(DB.Tables.publisherMembers).set({
                    role: PermissionHelper.OrgRoles.ADMIN,
                    is_publicly_hidden: false
                }).where(eq(DB.Tables.publisherMembers.id, existingMembership.id));
            } else {
                await tx.insert(DB.Tables.publisherMembers).values({
                    publisher_id: publisher.id,
                    user_id: new_owner_user_id,
                    role: PermissionHelper.OrgRoles.ADMIN,
                    is_publicly_hidden: false
                });
            }
        });

        return APIResponse.successNoData(c, "Publisher ownership transferred successfully");
    }
);

// Delete publisher — owner-only
router.delete('/:publisherName',

    APIRouteSpec.authenticated({
        summary: "Delete publisher",
        description: "Delete a publisher. Only the publisher owner (or site admin) can delete, and the publisher must have no packages.",
        tags: [DOCS_TAGS.PUBLISHERS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Publisher deleted successfully"),
            APIResponseSpec.notFound("Publisher not found"),
            APIResponseSpec.forbidden("Only the publisher owner can delete this publisher"),
            APIResponseSpec.badRequest("Cannot delete publisher with existing packages")
        )
    }),

    async (c) => {
        // @ts-ignore
        const publisher = c.get("publisher") as DB.Models.Publisher;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        if (authContext.type === "unauthenticated") {
            return APIResponse.unauthorized(c, "Authentication required");
        }

        const isOwner = publisher.owner_user_id === authContext.user_id;

        if (!isOwner && authContext.user_role !== 'admin') {
            return APIResponse.forbidden(c, "Only the publisher owner can delete this publisher");
        }

        const packageCount = await DB.instance()
            .select({ id: DB.Tables.packages.id })
            .from(DB.Tables.packages)
            .where(eq(DB.Tables.packages.publisher_id, publisher.id))
            .limit(1);

        if (packageCount.length > 0) {
            return APIResponse.badRequest(c, "Cannot delete publisher with existing packages");
        }

        await DB.instance().transaction(async (tx) => {
            await tx.delete(DB.Tables.publisherMembers).where(
                eq(DB.Tables.publisherMembers.publisher_id, publisher.id)
            );
            await tx.delete(DB.Tables.publishers).where(
                eq(DB.Tables.publishers.id, publisher.id)
            );
        });

        return APIResponse.successNoData(c, "Publisher deleted successfully");
    }
);

// Mount members router
router.route('/:publisherName', membersRouter);
