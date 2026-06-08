import { Hono } from "hono";
import { AccountModel } from './model'
import { validator } from "hono-openapi";
import { DB } from "../../../../../db";
import { eq } from "drizzle-orm";
import { APIResponse } from "../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { AuthHandler } from "../../../../utils/authHandler";
import { DOCS_TAGS } from "../../docs";
import { router as apiKeyRouter } from "./apikeys";

export const router = new Hono().basePath('/account');

// all routes below require authentication via session
router.use("*", async (c, next) => {
    // @ts-ignore
    const authContext = c.get("authContext") as AuthHandler.AuthContext;

    if (authContext.type !== 'session') {
        return APIResponse.unauthorized(c, "Your Auth Context is not a session");
    }

    await next();
});

router.get('/',

    APIRouteSpec.authenticated({
        summary: "Get account information",
        description: "Retrieve information about the authenticated user's account.",
        tags: [DOCS_TAGS.ACCOUNT],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Account information retrieved successfully", AccountModel.GetInfo.Response),
            APIResponseSpec.unauthorized("Your Auth Context is not a session")
        )
    }),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.SessionAuthContext;

        const user = DB.instance().select().from(DB.Tables.users).where(
            eq(DB.Tables.users.id, authContext.user_id)
        ).get();

        if (!user) {
            throw new Error("User not found but session exists");
        }

        const userWithoutSensitive = AccountModel.GetInfo.Response.parse(user);

        return APIResponse.success(c, "Account information retrieved successfully", userWithoutSensitive);
    }
);

router.put('/',

    APIRouteSpec.authenticated({
        summary: "Update account information",
        description: "Update information about the authenticated user's account.",
        tags: [DOCS_TAGS.ACCOUNT],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Account information updated successfully"), 
            APIResponseSpec.unauthorized("Your Auth Context is not a session")
        )
    }),

    validator("json", AccountModel.UpdateInfo.Body),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.SessionAuthContext;

        const body = c.req.valid("json") as AccountModel.UpdateInfo.Body;
        const { current_password, ...updates } = body;

        // Verify current password before allowing changes
        const user = DB.instance().select().from(DB.Tables.users).where(
            eq(DB.Tables.users.id, authContext.user_id)
        ).get();

        if (!user) {
            throw new Error("User not found but session exists");
        }

        if (!(await Bun.password.verify(current_password, user.password_hash))) {
            return APIResponse.unauthorized(c, "Current password is incorrect");
        }

        // Check for conflicts if changing username or email
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

        DB.instance().update(DB.Tables.users).set(updates).where(
            eq(DB.Tables.users.id, authContext.user_id)
        ).run();

        return APIResponse.successNoData(c, "Account information updated successfully");
    }
);

router.put('/password',

    APIRouteSpec.authenticated({
        summary: "Change account password",
        description: "Change the password of the authenticated user's account.",
        tags: [DOCS_TAGS.ACCOUNT],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Password changed successfully"),
            APIResponseSpec.unauthorized("Your Auth Context is not a session"),
            APIResponseSpec.badRequest("Current password is incorrect / Syntax or validation error in request")
        )
    }),

    validator("json", AccountModel.UpdatePassword.Body),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.SessionAuthContext;

        if (authContext.type !== 'session') {
            return APIResponse.unauthorized(c, "Your Auth Context is not a session");
        }

        const body = c.req.valid("json")

        const user = DB.instance().select().from(DB.Tables.users).where(
            eq(DB.Tables.users.id, authContext.user_id)
        ).get();
    
        if (!user) {
            throw new Error("User not found but session exists");
        }

        if ((await Bun.password.verify(body.current_password, user.password_hash)) === false) {
            return APIResponse.unauthorized(c, "Current password is incorrect");
        }

        const newPasswordHash = await Bun.password.hash(body.new_password);

        DB.instance().update(DB.Tables.users).set({
            password_hash: newPasswordHash
        }).where(
            eq(DB.Tables.users.id, authContext.user_id)
        ).run();

        await AuthHandler.invalidateAllAuthContextsForUser(authContext.user_id);

        await DB.instance().delete(DB.Tables.passwordResets).where(
            eq(DB.Tables.passwordResets.user_id, authContext.user_id)
        ).run();

        return APIResponse.successNoData(c, "Password changed successfully");
    }
);


router.delete('/',

    APIRouteSpec.authenticated({
        summary: "Delete account",
        description: "Permanently delete the authenticated user's account.",
        tags: [DOCS_TAGS.ACCOUNT],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Account deleted successfully"),
            APIResponseSpec.unauthorized("Your Auth Context is not a session")
        )
    }),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.SessionAuthContext;

        // Block deletion while the user owns any publishers — they must transfer or delete them first.
        const ownedPublishers = await DB.instance()
            .select({ id: DB.Tables.publishers.id })
            .from(DB.Tables.publishers)
            .where(eq(DB.Tables.publishers.owner_user_id, authContext.user_id))
            .limit(1);

        if (ownedPublishers.length > 0) {
            return APIResponse.badRequest(c, "You are the owner of one or more publishers. Transfer ownership or delete them before deleting your account.");
        }

        // invalidate all remaining bearer credentials before removing the user
        await AuthHandler.invalidateAllAuthContextsForUser(authContext.user_id);

        // delete password resets
        DB.instance().delete(DB.Tables.passwordResets).where(
            eq(DB.Tables.passwordResets.user_id, authContext.user_id)
        ).run();

        // finally, delete the user account
        DB.instance().delete(DB.Tables.users).where(
            eq(DB.Tables.users.id, authContext.user_id)
        ).run();

        return APIResponse.successNoData(c, "Account deleted successfully");
    },
);

router.route("/", apiKeyRouter);
