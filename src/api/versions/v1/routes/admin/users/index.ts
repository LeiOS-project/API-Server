import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { and, eq, like, or } from "drizzle-orm";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { UsersModel } from "./model";
import { AuthHandler } from "../../../../../utils/authHandler";
import { DOCS_TAGS } from "../../../docs";

const TARGET_USER_KEY = "targetUser";

const sanitizeUser = (user: DB.Models.User) => UsersModel.SafeUser.parse(user);

export const router = new Hono().basePath('/users');

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List users",
        description: "Retrieve LeiOS accounts with optional role and search filters.",
        tags: [DOCS_TAGS.ADMIN_USERS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Users retrieved successfully", UsersModel.GetAll.Response)
        )
    }),

    zValidator("query", UsersModel.GetAll.Query),

    async (c) => {
        const filters = c.req.valid("query") as UsersModel.GetAll.Query;

        let predicate: ReturnType<typeof eq> | undefined;

        if (filters.role) {
            predicate = eq(DB.Tables.users.role, filters.role);
        }

        if (filters.search) {
            const pattern = `%${filters.search}%`;
            const searchPredicate = or(
                like(DB.Tables.users.username, pattern),
                like(DB.Tables.users.display_name, pattern),
                like(DB.Tables.users.email, pattern),
            );

            predicate = predicate ? and(predicate, searchPredicate) : searchPredicate;
        }

        let query = DB.instance().select().from(DB.Tables.users).$dynamic();

        if (predicate) {
            query = query.where(predicate);
        }

        if (filters.limit) {
            query = query.limit(filters.limit);
        }

        if (filters.offset) {
            query = query.offset(filters.offset);
        }

        const users = await query.orderBy(DB.Tables.users.id);

        return APIResponse.success(c, "Users retrieved successfully", users.map(sanitizeUser));
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create user",
        description: "Provision a new LeiOS account with the desired role.",
        tags: [DOCS_TAGS.ADMIN_USERS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.created("User created successfully", UsersModel.Create.Response),
            APIResponseSpec.conflict("Conflict: Username or email already exists")
        )
    }),

    zValidator("json", UsersModel.Create.Body),

    async (c) => {
        const body = c.req.valid("json") as UsersModel.Create.Body;

        const duplicate = await DB.instance().select().from(DB.Tables.users).where(
            or(
                eq(DB.Tables.users.username, body.username),
                eq(DB.Tables.users.email, body.email)
            )
        ).get();

        if (duplicate) {
            return APIResponse.conflict(c, "A user with the same username or email already exists");
        }

        const { password, ...userData } = body;

        const createdUser = await DB.instance().insert(DB.Tables.users).values({
            ...userData,
            password_hash: await Bun.password.hash(password)
        }).returning().get();

        return APIResponse.created(c, "User created successfully", sanitizeUser(createdUser));
    }
);

router.use('/:userId/*',

    zValidator("param", UsersModel.UserId.Params),

    async (c, next) => {
        // @ts-ignore
        const { userId } = c.req.valid("param") as UsersModel.UserId.Params;

        const user = await DB.instance().select().from(DB.Tables.users).where(
            eq(DB.Tables.users.id, userId)
        ).get();

        if (!user) {
            return APIResponse.notFound(c, "User not found");
        }

        // Store the full user in context — strip password_hash only at the response boundary
        // @ts-ignore
        c.set(TARGET_USER_KEY, user);

        await next();
    }
);

router.get('/:userId',

    APIRouteSpec.authenticated({
        summary: "Get user",
        description: "Retrieve details for a specific LeiOS account.",
        tags: [DOCS_TAGS.ADMIN_USERS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("User retrieved successfully", UsersModel.Create.Response),
            APIResponseSpec.notFound("User not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const user = c.get(TARGET_USER_KEY) as DB.Models.User;
        return APIResponse.success(c, "User retrieved successfully", sanitizeUser(user));
    }
);

router.put('/:userId',

    APIRouteSpec.authenticated({
        summary: "Update user",
        description: "Modify profile fields or role for a LeiOS account.",
        tags: [DOCS_TAGS.ADMIN_USERS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("User updated successfully", UsersModel.Create.Response),
            APIResponseSpec.notFound("User not found"),
            APIResponseSpec.conflict("Conflict: Username or email already exists")
        )
    }),

    zValidator("json", UsersModel.Update.Body),

    async (c) => {
        // @ts-ignore
        const user = c.get(TARGET_USER_KEY) as DB.Models.User;
        const updateBody = c.req.valid("json") as UsersModel.Update.Body;

        const updates = Object.fromEntries(
            Object.entries(updateBody).filter(([, value]) => value !== undefined)
        ) as Partial<UsersModel.Update.Body>;

        if (Object.keys(updates).length === 0) {
            return APIResponse.badRequest(c, "Provide at least one field to update");
        }

        if (updates.username && updates.username !== user.username) {
            const usernameConflict = await DB.instance().select().from(DB.Tables.users).where(
                eq(DB.Tables.users.username, updates.username)
            ).get();

            if (usernameConflict) {
                return APIResponse.conflict(c, "Username already in use");
            }
        }

        if (updates.email && updates.email !== user.email) {
            const emailConflict = await DB.instance().select().from(DB.Tables.users).where(
                eq(DB.Tables.users.email, updates.email)
            ).get();

            if (emailConflict) {
                return APIResponse.conflict(c, "Email already in use");
            }
        }

        const roleChanged = updates.role && updates.role !== user.role;

        // Wrap the users table update and auth context update in a transaction
        // to prevent partial failure: if the auth context update fails, the role
        // change in the users table must be rolled back.
        await DB.instance().transaction(async (tx) => {
            await tx.update(DB.Tables.users).set(updates).where(
                eq(DB.Tables.users.id, user.id)
            ).run();

            if (roleChanged && updates.role) {
                await AuthHandler.changeUserRoleInAuthContexts(user.id, updates.role);
            }
        });

        const refreshed = await DB.instance().select().from(DB.Tables.users).where(
            eq(DB.Tables.users.id, user.id)
        ).get();

        if (!refreshed) {
            throw new Error("User not found after update");
        }

        return APIResponse.success(c, "User updated successfully", sanitizeUser(refreshed));
    }
);

router.put('/:userId/password',

    APIRouteSpec.authenticated({
        summary: "Reset user password",
        description: "Set a new password for a LeiOS account and revoke active sessions.",
        tags: [DOCS_TAGS.ADMIN_USERS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Password reset successfully"),
            APIResponseSpec.notFound("User not found")
        )
    }),

    zValidator("json", UsersModel.UpdatePassword.Body),

    async (c) => {
        // @ts-ignore
        const user = c.get(TARGET_USER_KEY) as DB.Models.User;
        const { password } = c.req.valid("json") as UsersModel.UpdatePassword.Body;

        const passwordHash = await Bun.password.hash(password);

        await DB.instance().update(DB.Tables.users).set({
            password_hash: passwordHash
        }).where(
            eq(DB.Tables.users.id, user.id)
        ).run();

        await AuthHandler.invalidateAllAuthContextsForUser(user.id);

        await DB.instance().delete(DB.Tables.passwordResets).where(
            eq(DB.Tables.passwordResets.user_id, user.id)
        ).run();

        return APIResponse.successNoData(c, "Password reset successfully");
    }
);

router.delete('/:userId',

    APIRouteSpec.authenticated({
        summary: "Delete user",
        description: "Permanently remove a LeiOS account after verifying the user does not own any publishers.",
        tags: [DOCS_TAGS.ADMIN_USERS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("User deleted successfully"),
            APIResponseSpec.notFound("User not found"),
            APIResponseSpec.badRequest("Cannot delete user while they own publishers")
        )
    }),

    async (c) => {
        // @ts-ignore
        const user = c.get(TARGET_USER_KEY) as DB.Models.User;

        const ownedPublishers = await DB.instance()
            .select({ id: DB.Tables.publishers.id, name: DB.Tables.publishers.name })
            .from(DB.Tables.publishers)
            .where(eq(DB.Tables.publishers.owner_user_id, user.id));

        if (ownedPublishers.length > 0) {
            return APIResponse.badRequest(
                c,
                `User owns ${ownedPublishers.length} publisher(s) (e.g. '${ownedPublishers[0]!.name}'). Transfer ownership or delete them first.`
            );
        }

        await AuthHandler.invalidateAllAuthContextsForUser(user.id);

        await DB.instance().delete(DB.Tables.passwordResets).where(
            eq(DB.Tables.passwordResets.user_id, user.id)
        ).run();

        await DB.instance().delete(DB.Tables.users).where(
            eq(DB.Tables.users.id, user.id)
        ).run();

        return APIResponse.successNoData(c, "User deleted successfully");
    }
);
