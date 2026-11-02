import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono-openapi";
import { DB } from "../../../../../db";
import { APIResponse } from "../../../../utils/api-res";
import { AuthHandler } from "../../../../utils/authHandler";
import { EmailVerificationHandler } from "../../../../utils/emailVerification";
import { RateLimiter } from "../../../../utils/rateLimiter";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { AccountModel } from "./model";

const verificationResendsPerUser = new RateLimiter(1, 5 * 60 * 1000); // 1 per 5 minutes

export const router = new Hono().basePath("/account");

// all routes below require authentication via session
router.use("*", async (c, next) => {
	const authContext = AuthHandler.AuthContext.get(c);

	if (authContext.type !== "session") {
		return APIResponse.unauthorized(c, "Your Auth Context is not a session");
	}

	await next();
});

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "Get account information",
		description: "Retrieve information about the authenticated user's account.",
		tags: [DOCS_TAGS.ACCOUNT],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Account information retrieved successfully",
				AccountModel.GetInfo.Response,
			),
			APIResponseSpec.unauthorized("Your Auth Context is not a session"),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.getAsSession(c);

		const user = DB.instance()
			.select()
			.from(DB.Tables.users)
			.where(eq(DB.Tables.users.id, authContext.user_id))
			.get();

		if (!user) {
			throw new Error("User not found but session exists");
		}

		const userWithoutSensitive = AccountModel.GetInfo.Response.parse(user);

		return APIResponse.success(c, "Account information retrieved successfully", userWithoutSensitive);
	},
);

router.put(
	"/",

	APIRouteSpec.authenticated({
		summary: "Update account information",
		description: "Update information about the authenticated user's account.",
		tags: [DOCS_TAGS.ACCOUNT],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Account information updated successfully"),
			APIResponseSpec.unauthorized("Your Auth Context is not a session"),
			APIResponseSpec.forbidden("Current password is incorrect"),
			APIResponseSpec.conflict("Username already in use / Email already in use"),
		),
	}),

	validator("json", AccountModel.UpdateInfo.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.getAsSession(c);

		const body = c.req.valid("json") as AccountModel.UpdateInfo.Body;
		const { current_password, ...updates } = body;

		// Verify current password before allowing changes
		const user = DB.instance()
			.select()
			.from(DB.Tables.users)
			.where(eq(DB.Tables.users.id, authContext.user_id))
			.get();

		if (!user) {
			throw new Error("User not found but session exists");
		}

		if (!(await Bun.password.verify(current_password, user.password_hash))) {
			// 403, not 401: the session is fine, and clients treat any 401 as a signed-out session.
			return APIResponse.forbidden(c, "Current password is incorrect");
		}

		// Check for conflicts if changing username or email
		if (updates.username && updates.username !== user.username) {
			const usernameConflict = await DB.instance()
				.select()
				.from(DB.Tables.users)
				.where(eq(DB.Tables.users.username, updates.username))
				.get();
			if (usernameConflict) {
				return APIResponse.conflict(c, "Username already in use");
			}
		}

		if (updates.email && updates.email !== user.email) {
			const emailConflict = await DB.instance()
				.select()
				.from(DB.Tables.users)
				.where(eq(DB.Tables.users.email, updates.email))
				.get();
			if (emailConflict) {
				return APIResponse.conflict(c, "Email already in use");
			}
		}

		const emailChanged = updates.email !== undefined && updates.email !== user.email;

		await DB.instance().transaction(async (tx) => {
			await tx
				.update(DB.Tables.users)
				.set({
					...updates,
					// A new address has to be confirmed again.
					...(emailChanged ? { email_verified_at: null } : {}),
				})
				.where(eq(DB.Tables.users.id, authContext.user_id))
				.run();

			if (emailChanged && updates.email) {
				await EmailVerificationHandler.start(authContext.user_id, updates.email, "change", tx);
			}
		});

		return APIResponse.successNoData(c, "Account information updated successfully");
	},
);

router.put(
	"/password",

	APIRouteSpec.authenticated({
		summary: "Change account password",
		description: "Change the password of the authenticated user's account.",
		tags: [DOCS_TAGS.ACCOUNT],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Password changed successfully"),
			APIResponseSpec.unauthorized("Your Auth Context is not a session"),
			APIResponseSpec.badRequest("Syntax or validation error in request"),
			APIResponseSpec.forbidden("Current password is incorrect"),
		),
	}),

	validator("json", AccountModel.UpdatePassword.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.getAsSession(c);

		if (authContext.type !== "session") {
			return APIResponse.unauthorized(c, "Your Auth Context is not a session");
		}

		const body = c.req.valid("json");

		const user = DB.instance()
			.select()
			.from(DB.Tables.users)
			.where(eq(DB.Tables.users.id, authContext.user_id))
			.get();

		if (!user) {
			throw new Error("User not found but session exists");
		}

		if ((await Bun.password.verify(body.current_password, user.password_hash)) === false) {
			// 403, not 401: the session is fine, and clients treat any 401 as a signed-out session.
			return APIResponse.forbidden(c, "Current password is incorrect");
		}

		const newPasswordHash = await Bun.password.hash(body.new_password);

		DB.instance()
			.update(DB.Tables.users)
			.set({
				password_hash: newPasswordHash,
			})
			.where(eq(DB.Tables.users.id, authContext.user_id))
			.run();

		await AuthHandler.invalidateAllAuthContextsForUser(authContext.user_id);

		await DB.instance()
			.delete(DB.Tables.passwordResets)
			.where(eq(DB.Tables.passwordResets.user_id, authContext.user_id))
			.run();

		return APIResponse.successNoData(c, "Password changed successfully");
	},
);

router.post(
	"/email-verification",

	APIRouteSpec.authenticated({
		summary: "Resend the verification email",
		description:
			"Send a new confirmation link for the authenticated user's email address, if it is not confirmed yet.",
		tags: [DOCS_TAGS.ACCOUNT],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Verification email sent"),
			APIResponseSpec.unauthorized("Your Auth Context is not a session"),
			APIResponseSpec.conflict("Your email address is already confirmed"),
			APIResponseSpec.tooManyRequests("Please wait a few minutes before requesting another email"),
			APIResponseSpec.serverError("Email is not configured on this server"),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.getAsSession(c);

		const user = await DB.instance()
			.select({ email: DB.Tables.users.email, email_verified_at: DB.Tables.users.email_verified_at })
			.from(DB.Tables.users)
			.where(eq(DB.Tables.users.id, authContext.user_id))
			.get();

		if (!user) {
			throw new Error("User not found but session exists");
		}

		if (user.email_verified_at !== null) {
			return APIResponse.conflict(c, "Your email address is already confirmed");
		}

		if (!verificationResendsPerUser.hit(String(authContext.user_id))) {
			return APIResponse.tooManyRequests(
				c,
				"Please wait a few minutes before requesting another email",
			);
		}

		const sent = await EmailVerificationHandler.start(authContext.user_id, user.email, "signup");
		if (!sent) {
			return APIResponse.serverError(c, "Email is not configured on this server");
		}

		return APIResponse.successNoData(c, "Verification email sent");
	},
);

router.delete(
	"/",

	APIRouteSpec.authenticated({
		summary: "Delete account",
		description: "Permanently delete the authenticated user's account.",
		tags: [DOCS_TAGS.ACCOUNT],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Account deleted successfully"),
			APIResponseSpec.unauthorized("Your Auth Context is not a session"),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.getAsSession(c);

		// Block deletion while the user owns any publishers — they must transfer or delete them first.
		const ownedPublishers = await DB.instance()
			.select({ id: DB.Tables.publishers.id })
			.from(DB.Tables.publishers)
			.where(eq(DB.Tables.publishers.owner_user_id, authContext.user_id))
			.limit(1);

		if (ownedPublishers.length > 0) {
			return APIResponse.badRequest(
				c,
				"You are the owner of one or more publishers. Transfer ownership or delete them before deleting your account.",
			);
		}

		// invalidate all remaining bearer credentials before removing the user
		await AuthHandler.invalidateAllAuthContextsForUser(authContext.user_id);

		// delete password resets
		DB.instance()
			.delete(DB.Tables.passwordResets)
			.where(eq(DB.Tables.passwordResets.user_id, authContext.user_id))
			.run();

		// finally, delete the user account
		DB.instance().delete(DB.Tables.users).where(eq(DB.Tables.users.id, authContext.user_id)).run();

		return APIResponse.successNoData(c, "Account deleted successfully");
	},
);

router.route("/", (await import("./apikeys")).router);
