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
import { Utils } from "../../../../../utils";

export const router = new Hono().basePath('/members');

// List members
router.get('/',

    APIRouteSpec.unauthenticated({
        summary: "List members",
        description: "Retrieve all members of a publisher. Hidden members are only visible to other members and site admins.",
        tags: [DOCS_TAGS.PUBLISHERS_MEMBERS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Members retrieved successfully", PublisherModel.Members.ListAll.Response)
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
                // Check if the user is a member of the publisher, which allows them to see hidden members
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
            .select({
                id: DB.Tables.publisherMembers.id,

                user_id: DB.Tables.publisherMembers.user_id,
                user_username: DB.Tables.users.username,
                user_display_name: DB.Tables.users.display_name,
                role: DB.Tables.publisherMembers.role,

                is_publicly_hidden: DB.Tables.publisherMembers.is_publicly_hidden,

                added_at: DB.Tables.publisherMembers.added_at
            })
            .from(DB.Tables.publisherMembers)
            .innerJoin(DB.Tables.users, eq(DB.Tables.users.id, DB.Tables.publisherMembers.user_id))
            .where(eq(DB.Tables.publisherMembers.publisher_id, publisher.id));

        const members = canSeeHidden ? all : all.filter((m) => !m.is_publicly_hidden);

        return APIResponse.success(c, "Members retrieved successfully", Utils.asExact<PublisherModel.Members.ListAll.Response>()(members));
    }
);

// Add member
router.post('/',

    APIRouteSpec.authenticated({
        summary: "Add member",
        description: "Add a new member to a publisher with the given role.",
        tags: [DOCS_TAGS.PUBLISHERS_MEMBERS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.created("Member added successfully", PublisherModel.Members.AddMember.Response),
            APIResponseSpec.conflict("User is already a member"),
            APIResponseSpec.forbidden("You do not have permission to manage members"),
            APIResponseSpec.notFound("User not found")
        )
    }),

    zValidator("json", PublisherModel.Members.AddMember.Body),

    async (c) => {
        // @ts-ignore
        const publisher = c.get("publisher") as DB.Models.Publisher;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        const body = c.req.valid("json");

        const allowed = await PermissionHelper.can({
            authContext, publisher,
            check: (myPerms, myRole) => {
                if (!myPerms.members.invite) return false;

                // check if i have a higher role than the target member, admins cant invite other admins
                if (PermissionHelper.compareRoles(myRole, body.role) === 1) {
                    return true;
                }

                return false;
            }
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to invite that member");
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

        const member = await DB.instance().insert(DB.Tables.publisherMembers).values({
            publisher_id: publisher.id,
            user_id: body.user_id,
            role: body.role,
            is_publicly_hidden: body.is_publicly_hidden ?? false
        }).returning().get();

        return APIResponse.created(c, "Member added successfully", { id: member.id } satisfies PublisherModel.Members.AddMember.Response);
    }
);

router.use('/:userId/*',

    zValidator("param", z.object({
        userId: z.coerce.number().int().positive()
    })),

    async (c, next) => {
        // @ts-ignore
        const publisher = c.get("publisher") as DB.Models.Publisher;
        // @ts-ignore
        const { userId } = c.req.valid("param") as { userId: number };

        const member: DB.Models.PublisherMember | undefined = await DB.instance()
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

        // @ts-ignore
        c.set("member", member);

        return await next();
    }
);

router.get('/:userId',

    APIRouteSpec.authenticated({
        summary: "Get member by ID",
        description: "Retrieve a single publisher member by their user ID.",
        tags: [DOCS_TAGS.PUBLISHERS_MEMBERS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Member retrieved successfully", PublisherModel.Members.GetMemberByID.Response),
            APIResponseSpec.notFound("Member not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const member = c.get("member") as DB.Models.PublisherMember;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        if (member.is_publicly_hidden) {
            let canSeeHidden = false;
            if (authContext.type !== 'unauthenticated') {
                if (authContext.user_role === 'admin') {
                    canSeeHidden = true;
                } else {
                    // Check if the user is a member of the publisher, which allows them to see hidden members
                    const membership = await DB.instance()
                        .select({ id: DB.Tables.publisherMembers.id })
                        .from(DB.Tables.publisherMembers)
                        .where(and(
                            eq(DB.Tables.publisherMembers.publisher_id, member.publisher_id),
                            eq(DB.Tables.publisherMembers.user_id, authContext.user_id)
                        ))
                        .get();
                    canSeeHidden = !!membership;
                }
            }

            if (!canSeeHidden) {
                return APIResponse.notFound(c, "Member not found");
            }
        }

        const memberUserData = await DB.instance()
            .select({
                user_username: DB.Tables.users.username,
                user_display_name: DB.Tables.users.display_name,
            })
            .from(DB.Tables.users)
            .where(eq(DB.Tables.users.id, member.user_id))
            .get();

        if (!memberUserData) {
            throw new Error("Inconsistent database state: publisher member references non-existent user");
        }

        const response: PublisherModel.Members.GetMemberByID.Response = {
            id: member.id,
            user_id: member.user_id,
            user_username: memberUserData.user_username,
            user_display_name: memberUserData.user_display_name,
            role: member.role,
            is_publicly_hidden: member.is_publicly_hidden,
            added_at: member.added_at
        };

        return APIResponse.success(c, "Member retrieved successfully", response);
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

    zValidator("json", PublisherModel.Members.UpdateMember.Body),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        // @ts-ignore
        const publisher = c.get("publisher") as DB.Models.Publisher;

        // @ts-ignore
        const member = c.get("member") as DB.Models.PublisherMember;

        const body = c.req.valid("json");

        const allowed = await PermissionHelper.can({
            authContext,
            publisher,
            check: (myPerms, myRole) => {
                if (!myPerms.members.update) return false;

                // check if i have a higher role than the target member, admins cant modify other admins
                const memberCurrentRole = member.role;
                const memberTargetRole = body.role ?? memberCurrentRole;

                const compare1 = PermissionHelper.compareRoles(myRole, memberCurrentRole);
                const compare2 = PermissionHelper.compareRoles(myRole, memberTargetRole);

                if (compare1 === 1 && compare2 === 1) {
                    return true;
                }

                return false;
            }
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to manage the member's membership");
        }

        if (member.user_id === publisher.owner_user_id) {
            return APIResponse.badRequest(c, "Cannot modify the publisher owner's membership");
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

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        // @ts-ignore
        const publisher = c.get("publisher") as DB.Models.Publisher;
        // @ts-ignore
        const member = c.get("member") as DB.Models.PublisherMember;

        const allowed = await PermissionHelper.can({
            authContext,
            publisher,
            check: (myPerms, myRole) => {
                if (!myPerms.members.remove) return false;

                // check if i have a higher role than the target member, admins cant remove other admins
                if (PermissionHelper.compareRoles(myRole, member.role) === 1) {
                    return true;
                }

                return false;
            }
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to manage members");
        }

        if (member.user_id === publisher.owner_user_id) {
            return APIResponse.badRequest(c, "Cannot remove the publisher owner");
        }

        await DB.instance().delete(DB.Tables.publisherMembers).where(
            eq(DB.Tables.publisherMembers.id, member.id)
        );

        return APIResponse.successNoData(c, "Member removed successfully");
    }
);
