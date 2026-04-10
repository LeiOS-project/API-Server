import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { PublisherModel } from "./model";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { AuthHandler } from "../../../../utils/authHandler";
import { APIResponse } from "../../../../utils/api-res";
import { DB } from "../../../../../db";
import { PermissionHelper } from "../../../../../utils/permission-helper";

export const router = new Hono().basePath('/members');

// List members
router.get('/',

    APIRouteSpec.unauthenticated({
        summary: "List members",
        description: "Retrieve all members of a publisher. Hidden members are only visible to other members and site admins.",
        tags: [DOCS_TAGS.PUBLISHERS_MEMBERS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Members retrieved successfully", PublisherModel.ListMembers.Response)
        )
    }),

    async (c) => {
        // @ts-ignore
        const publisher = c.get("publisher") as DB.Models.Publisher;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        let canSeeHidden = false;
        if (authContext.type !== 'unauthenticated') {
            if (authContext.user_role === 'admin') {
                canSeeHidden = true;
            } else {
                const membership = await DB.instance()
                    .select({ id: DB.Tables.publisherMembers.id })
                    .from(DB.Tables.publisherMembers)
                    .where(and(
                        eq(DB.Tables.publisherMembers.publisher_id, publisher.id),
                        eq(DB.Tables.publisherMembers.user_id, authContext.user_id)
                    ))
                    .get();
                canSeeHidden = !!membership;
            }
        }

        const all = await DB.instance()
            .select()
            .from(DB.Tables.publisherMembers)
            .where(eq(DB.Tables.publisherMembers.publisher_id, publisher.id));

        const members = canSeeHidden ? all : all.filter((m) => !m.is_publicly_hidden);

        return APIResponse.success(c, "Members retrieved successfully", members satisfies PublisherModel.ListMembers.Response);
    }
);

// Add member
router.post('/',

    APIRouteSpec.authenticated({
        summary: "Add member",
        description: "Add a new member to a publisher with the given role.",
        tags: [DOCS_TAGS.PUBLISHERS_MEMBERS],
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.createdNoData("Member added successfully"),
            APIResponseSpec.conflict("User is already a member"),
            APIResponseSpec.forbidden("You do not have permission to manage members"),
            APIResponseSpec.notFound("User not found")
        )
    }),

    zValidator("json", PublisherModel.AddMember.Body),

    async (c) => {
        // @ts-ignore
        const publisher = c.get("publisher") as DB.Models.Publisher;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        const body = c.req.valid("json");

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: publisher.id,
            permission: (p) => p.members.invite
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to manage members");
        }

        const user = await DB.instance()
            .select({ id: DB.Tables.users.id })
            .from(DB.Tables.users)
            .where(eq(DB.Tables.users.id, body.user_id))
            .get();

        if (!user) {
            return APIResponse.notFound(c, "User not found");
        }

        const existing = await DB.instance()
            .select({ id: DB.Tables.publisherMembers.id })
            .from(DB.Tables.publisherMembers)
            .where(and(
                eq(DB.Tables.publisherMembers.publisher_id, publisher.id),
                eq(DB.Tables.publisherMembers.user_id, body.user_id)
            ))
            .get();

        if (existing) {
            return APIResponse.conflict(c, "User is already a member");
        }

        await DB.instance().insert(DB.Tables.publisherMembers).values({
            publisher_id: publisher.id,
            user_id: body.user_id,
            role: body.role,
            is_publicly_hidden: body.is_publicly_hidden ?? false
        });

        return APIResponse.createdNoData(c, "Member added successfully");
    }
);

// Update member
router.put('/:userId',

    APIRouteSpec.authenticated({
        summary: "Update member",
        description: "Update a publisher member's role or visibility. Cannot modify the publisher owner's membership.",
        tags: [DOCS_TAGS.PUBLISHERS_MEMBERS],
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Member updated successfully"),
            APIResponseSpec.notFound("Member not found"),
            APIResponseSpec.forbidden("You do not have permission to manage members"),
            APIResponseSpec.badRequest("Cannot modify the publisher owner's membership")
        )
    }),

    zValidator("param", z.object({
        userId: z.coerce.number().int().positive()
    })),

    zValidator("json", PublisherModel.UpdateMember.Body),

    async (c) => {
        // @ts-ignore
        const publisher = c.get("publisher") as DB.Models.Publisher;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        // @ts-ignore
        const { userId } = c.req.valid("param") as { userId: number };
        const body = c.req.valid("json");

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: publisher.id,
            permission: (p) => p.members.updateRole
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to manage members");
        }

        if (userId === publisher.owner_user_id) {
            return APIResponse.badRequest(c, "Cannot modify the publisher owner's membership");
        }

        const member = await DB.instance()
            .select()
            .from(DB.Tables.publisherMembers)
            .where(and(
                eq(DB.Tables.publisherMembers.publisher_id, publisher.id),
                eq(DB.Tables.publisherMembers.user_id, userId)
            ))
            .get();

        if (!member) {
            return APIResponse.notFound(c, "Member not found");
        }

        const updates: Partial<typeof DB.Tables.publisherMembers.$inferInsert> = {};
        if (body.role !== undefined) updates.role = body.role;
        if (body.is_publicly_hidden !== undefined) updates.is_publicly_hidden = body.is_publicly_hidden;

        await DB.instance()
            .update(DB.Tables.publisherMembers)
            .set(updates)
            .where(eq(DB.Tables.publisherMembers.id, member.id));

        return APIResponse.successNoData(c, "Member updated successfully");
    }
);

// Remove member
router.delete('/:userId',

    APIRouteSpec.authenticated({
        summary: "Remove member",
        description: "Remove a member from a publisher. The publisher owner cannot be removed — transfer ownership first.",
        tags: [DOCS_TAGS.PUBLISHERS_MEMBERS],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Member removed successfully"),
            APIResponseSpec.notFound("Member not found"),
            APIResponseSpec.forbidden("You do not have permission to manage members"),
            APIResponseSpec.badRequest("Cannot remove the publisher owner")
        )
    }),

    zValidator("param", z.object({
        userId: z.coerce.number().int().positive()
    })),

    async (c) => {
        // @ts-ignore
        const publisher = c.get("publisher") as DB.Models.Publisher;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        // @ts-ignore
        const { userId } = c.req.valid("param") as { userId: number };

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: publisher.id,
            permission: (p) => p.members.remove
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to manage members");
        }

        if (userId === publisher.owner_user_id) {
            return APIResponse.badRequest(c, "Cannot remove the publisher owner");
        }

        const member = await DB.instance()
            .select({ id: DB.Tables.publisherMembers.id })
            .from(DB.Tables.publisherMembers)
            .where(and(
                eq(DB.Tables.publisherMembers.publisher_id, publisher.id),
                eq(DB.Tables.publisherMembers.user_id, userId)
            ))
            .get();

        if (!member) {
            return APIResponse.notFound(c, "Member not found");
        }

        await DB.instance().delete(DB.Tables.publisherMembers).where(
            eq(DB.Tables.publisherMembers.id, member.id)
        );

        return APIResponse.successNoData(c, "Member removed successfully");
    }
);
