import { randomBytes as crypto_randomBytes } from "node:crypto";
import { and, eq, isNotNull, isNull, like, or, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { ConfigHandler } from "../../../../../../utils/config";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { EmailService } from "../../../../../utils/email";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { hashResetToken } from "../../auth/reset-password";
import { UsersModel } from "./model";

const sanitizeUser = (user: DB.Models.User) => UsersModel.SafeUser.parse(user);

/** Per-request values loaded by the parameter middlewares (this router's or a parent's). */
type Variables = {
	targetUser: DB.Models.User;
};

export const router = new Hono<{ Variables: Variables }>().basePath("/users");

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List users",
		description: "Retrieve LeiOS accounts with optional role and search filters.",
		tags: [DOCS_TAGS.ADMIN_USERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Users retrieved successfully", UsersModel.GetAll.Response),
		),
	}),

	zValidator("query", UsersModel.GetAll.Query),

	async (c) => {
		const filters = c.req.valid("query") as UsersModel.GetAll.Query;

		let predicate: SQL | undefined;

		if (filters.role) {
			predicate = eq(DB.Tables.users.role, filters.role);
		}

		if (filters.status) {
			predicate = and(predicate, eq(DB.Tables.users.status, filters.status));
		}

		if (filters.verified !== undefined) {
			predicate = and(
				predicate,
				filters.verified
					? isNotNull(DB.Tables.users.email_verified_at)
					: isNull(DB.Tables.users.email_verified_at),
			);
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

		const users = await DB.instance()
			.select()
			.from(DB.Tables.users)
			.where(predicate)
			.orderBy(DB.Tables.users.id)
			.limit(filters.limit)
			.offset(filters.offset);

		const total = await DB.instance().$count(DB.Tables.users, predicate);

		return APIResponse.success(c, "Users retrieved successfully", {
			items: users.map(sanitizeUser),
			total,
		} satisfies UsersModel.GetAll.Response);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create user",
		description: "Provision a new LeiOS account with the desired role.",
		tags: [DOCS_TAGS.ADMIN_USERS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("User created successfully", UsersModel.Create.Response),
			APIResponseSpec.conflict("Conflict: Username or email already exists"),
		),
	}),

	zValidator("json", UsersModel.Create.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		const body = c.req.valid("json") as UsersModel.Create.Body;

		const duplicate = await DB.instance()
			.select()
			.from(DB.Tables.users)
			.where(or(eq(DB.Tables.users.username, body.username), eq(DB.Tables.users.email, body.email)))
			.get();

		if (duplicate) {
			return APIResponse.conflict(c, "A user with the same username or email already exists");
		}

		const { password, ...userData } = body;

		const passwordHash = await Bun.password.hash(password);

		const createdUser = await DB.instance().transaction(async (tx) => {
			const created = await tx
				.insert(DB.Tables.users)
				.values({
					...userData,
					password_hash: passwordHash,
					// The admin vouches for the address.
					email_verified_at: Date.now(),
				})
				.returning()
				.get();

			await AuditLog.record(
				{
					actor: authContext,
					action: "user.create",
					targetType: "user",
					targetID: created.id,
					targetLabel: created.username,
					metadata: { role: created.role },
				},
				tx,
			);

			return created;
		});

		return APIResponse.created(c, "User created successfully", sanitizeUser(createdUser));
	},
);

router.use(
	"/:userId/*",

	zValidator("param", UsersModel.UserId.Params),

	async (c, next) => {
		// @ts-expect-error - hono-openapi's validator does not type "param" yet
		const { userId } = c.req.valid("param") as UsersModel.UserId.Params;

		const user = await DB.instance()
			.select()
			.from(DB.Tables.users)
			.where(eq(DB.Tables.users.id, userId))
			.get();

		if (!user) {
			return APIResponse.notFound(c, "User not found");
		}

		// Store the full user in context — strip password_hash only at the response boundary
		c.set("targetUser", user);

		await next();
	},
);

router.get(
	"/:userId",

	APIRouteSpec.authenticated({
		summary: "Get user",
		description: "Retrieve details for a specific LeiOS account.",
		tags: [DOCS_TAGS.ADMIN_USERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("User retrieved successfully", UsersModel.Create.Response),
			APIResponseSpec.notFound("User not found"),
		),
	}),

	async (c) => {
		const user = c.get("targetUser");
		return APIResponse.success(c, "User retrieved successfully", sanitizeUser(user));
	},
);

router.put(
	"/:userId",

	APIRouteSpec.authenticated({
		summary: "Update user",
		description: "Modify profile fields or role for a LeiOS account.",
		tags: [DOCS_TAGS.ADMIN_USERS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("User updated successfully", UsersModel.Create.Response),
			APIResponseSpec.notFound("User not found"),
			APIResponseSpec.conflict("Conflict: Username or email already exists"),
		),
	}),

	zValidator("json", UsersModel.Update.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		const user = c.get("targetUser");
		const updateBody = c.req.valid("json") as UsersModel.Update.Body;

		const updates = Object.fromEntries(
			Object.entries(updateBody).filter(([, value]) => value !== undefined),
		) as Partial<UsersModel.Update.Body>;

		if (Object.keys(updates).length === 0) {
			return APIResponse.badRequest(c, "Provide at least one field to update");
		}

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

		const roleChanged = updates.role && updates.role !== user.role;

		// Wrap the users table update and auth context update in a transaction
		// to prevent partial failure: if the auth context update fails, the role
		// change in the users table must be rolled back.
		await DB.instance().transaction(async (tx) => {
			await tx.update(DB.Tables.users).set(updates).where(eq(DB.Tables.users.id, user.id)).run();

			if (roleChanged && updates.role) {
				await AuthHandler.changeUserRoleInAuthContexts(user.id, updates.role, tx);
			}

			await AuditLog.record(
				{
					actor: authContext,
					action: roleChanged ? "user.role_change" : "user.update",
					targetType: "user",
					targetID: user.id,
					targetLabel: user.username,
					metadata: {
						fields: Object.keys(updates),
						...(roleChanged ? { from: user.role, to: updates.role } : {}),
					},
				},
				tx,
			);
		});

		const refreshed = await DB.instance()
			.select()
			.from(DB.Tables.users)
			.where(eq(DB.Tables.users.id, user.id))
			.get();

		if (!refreshed) {
			throw new Error("User not found after update");
		}

		return APIResponse.success(c, "User updated successfully", sanitizeUser(refreshed));
	},
);

router.put(
	"/:userId/password",

	APIRouteSpec.authenticated({
		summary: "Reset user password",
		description: "Set a new password for a LeiOS account and revoke active sessions.",
		tags: [DOCS_TAGS.ADMIN_USERS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Password reset successfully"),
			APIResponseSpec.notFound("User not found"),
		),
	}),

	zValidator("json", UsersModel.UpdatePassword.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		const user = c.get("targetUser");
		const { password } = c.req.valid("json") as UsersModel.UpdatePassword.Body;

		const passwordHash = await Bun.password.hash(password);

		await DB.instance().transaction(async (tx) => {
			await tx
				.update(DB.Tables.users)
				.set({
					password_hash: passwordHash,
				})
				.where(eq(DB.Tables.users.id, user.id))
				.run();

			await AuthHandler.invalidateAllAuthContextsForUser(user.id, tx);

			await tx
				.delete(DB.Tables.passwordResets)
				.where(eq(DB.Tables.passwordResets.user_id, user.id))
				.run();

			await AuditLog.record(
				{
					actor: authContext,
					action: "user.password_set",
					targetType: "user",
					targetID: user.id,
					targetLabel: user.username,
				},
				tx,
			);
		});

		return APIResponse.successNoData(c, "Password reset successfully");
	},
);

router.delete(
	"/:userId",

	APIRouteSpec.authenticated({
		summary: "Delete user",
		description:
			"Permanently remove a LeiOS account after verifying the user does not own any publishers.",
		tags: [DOCS_TAGS.ADMIN_USERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("User deleted successfully"),
			APIResponseSpec.notFound("User not found"),
			APIResponseSpec.badRequest(
				"Cannot delete user while they own publishers / Use the account settings to delete your own account",
			),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		const user = c.get("targetUser");

		if (authContext.type !== "unauthenticated" && authContext.user_id === user.id) {
			return APIResponse.badRequest(c, "Use the account settings to delete your own account");
		}

		const ownedPublishers = await DB.instance()
			.select({ id: DB.Tables.publishers.id, name: DB.Tables.publishers.name })
			.from(DB.Tables.publishers)
			.where(eq(DB.Tables.publishers.owner_user_id, user.id));

		if (ownedPublishers.length > 0) {
			return APIResponse.badRequest(
				c,
				`User owns ${ownedPublishers.length} publisher(s) (e.g. '${ownedPublishers[0]!.name}'). Transfer ownership or delete them first.`,
			);
		}

		await AuthHandler.invalidateAllAuthContextsForUser(user.id);

		await DB.instance()
			.delete(DB.Tables.passwordResets)
			.where(eq(DB.Tables.passwordResets.user_id, user.id))
			.run();

		await DB.instance().delete(DB.Tables.users).where(eq(DB.Tables.users.id, user.id)).run();

		await AuditLog.record({
			actor: authContext,
			action: "user.delete",
			targetType: "user",
			targetID: user.id,
			targetLabel: user.username,
		});

		return APIResponse.successNoData(c, "User deleted successfully");
	},
);

router.post(
	"/:userId/suspend",

	APIRouteSpec.authenticated({
		summary: "Suspend user",
		description:
			"Block an account from signing in and end all its sessions and API keys. Publishers and packages it owns stay as they are.",
		tags: [DOCS_TAGS.ADMIN_USERS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("User suspended"),
			APIResponseSpec.notFound("User not found"),
			APIResponseSpec.conflict("User is already suspended / You cannot suspend yourself"),
		),
	}),

	zValidator("json", UsersModel.Suspend.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		const user = c.get("targetUser");
		const { reason } = c.req.valid("json");

		if (authContext.type !== "unauthenticated" && authContext.user_id === user.id) {
			return APIResponse.conflict(c, "You cannot suspend yourself");
		}
		if (user.status === "suspended") {
			return APIResponse.conflict(c, "User is already suspended");
		}

		await DB.instance().transaction(async (tx) => {
			await tx
				.update(DB.Tables.users)
				.set({ status: "suspended", suspended_at: Date.now(), suspended_reason: reason })
				.where(eq(DB.Tables.users.id, user.id))
				.run();

			await AuthHandler.invalidateAllAuthContextsForUser(user.id, tx);

			await AuditLog.record(
				{
					actor: authContext,
					action: "user.suspend",
					targetType: "user",
					targetID: user.id,
					targetLabel: user.username,
					metadata: { reason },
				},
				tx,
			);
		});

		return APIResponse.successNoData(c, "User suspended");
	},
);

router.post(
	"/:userId/unsuspend",

	APIRouteSpec.authenticated({
		summary: "Lift suspension",
		description: "Allow a suspended account to sign in again.",
		tags: [DOCS_TAGS.ADMIN_USERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Suspension lifted"),
			APIResponseSpec.notFound("User not found"),
			APIResponseSpec.conflict("User is not suspended"),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		const user = c.get("targetUser");

		if (user.status !== "suspended") {
			return APIResponse.conflict(c, "User is not suspended");
		}

		await DB.instance().transaction(async (tx) => {
			await tx
				.update(DB.Tables.users)
				.set({ status: "active", suspended_at: null, suspended_reason: null })
				.where(eq(DB.Tables.users.id, user.id))
				.run();

			await AuditLog.record(
				{
					actor: authContext,
					action: "user.unsuspend",
					targetType: "user",
					targetID: user.id,
					targetLabel: user.username,
				},
				tx,
			);
		});

		return APIResponse.successNoData(c, "Suspension lifted");
	},
);

router.post(
	"/:userId/password-reset-link",

	APIRouteSpec.authenticated({
		summary: "Create a password reset link",
		description:
			"Create a one-time password reset link (valid 24 hours) to hand to the user, and email it to them when email is configured.",
		tags: [DOCS_TAGS.ADMIN_USERS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Password reset link created", UsersModel.PasswordResetLink.Response),
			APIResponseSpec.notFound("User not found"),
		),
	}),

	zValidator("json", UsersModel.PasswordResetLink.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		const user = c.get("targetUser");
		const { send_email } = c.req.valid("json");

		const rawToken = crypto_randomBytes(64).toString("hex");
		const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

		await DB.instance().transaction(async (tx) => {
			await tx
				.delete(DB.Tables.passwordResets)
				.where(eq(DB.Tables.passwordResets.user_id, user.id))
				.run();

			await tx
				.insert(DB.Tables.passwordResets)
				.values({ token: hashResetToken(rawToken), user_id: user.id, expires_at: expiresAt })
				.run();

			await AuditLog.record(
				{
					actor: authContext,
					action: "user.password_reset_link",
					targetType: "user",
					targetID: user.id,
					targetLabel: user.username,
					metadata: { emailed: send_email && EmailService.isEnabled() },
				},
				tx,
			);
		});

		const emailed = send_email && EmailService.isEnabled();
		if (emailed) {
			await EmailService.sendPasswordResetEmail(user.email, rawToken);
		}

		const appUrl = (ConfigHandler.getConfig()?.APP_URL ?? "").replace(/\/+$/, "");

		return APIResponse.created(c, "Password reset link created", {
			reset_url: `${appUrl}/auth/reset-password?token=${encodeURIComponent(rawToken)}`,
			expires_at: expiresAt,
			emailed,
		} satisfies UsersModel.PasswordResetLink.Response);
	},
);

router.post(
	"/:userId/revoke-sessions",

	APIRouteSpec.authenticated({
		summary: "Sign user out everywhere",
		description: "End all sessions and delete all API keys of an account.",
		tags: [DOCS_TAGS.ADMIN_USERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("All sessions and API keys revoked"),
			APIResponseSpec.notFound("User not found"),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		const user = c.get("targetUser");

		await DB.instance().transaction(async (tx) => {
			await AuthHandler.invalidateAllAuthContextsForUser(user.id, tx);

			await AuditLog.record(
				{
					actor: authContext,
					action: "user.sessions_revoke",
					targetType: "user",
					targetID: user.id,
					targetLabel: user.username,
				},
				tx,
			);
		});

		return APIResponse.successNoData(c, "All sessions and API keys revoked");
	},
);

router.post(
	"/:userId/verify-email",

	APIRouteSpec.authenticated({
		summary: "Mark email as confirmed",
		description:
			"Confirm a user's email address on their behalf, e.g. when the verification email cannot reach them.",
		tags: [DOCS_TAGS.ADMIN_USERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Email address marked as confirmed"),
			APIResponseSpec.notFound("User not found"),
			APIResponseSpec.conflict("Email address is already confirmed"),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		const user = c.get("targetUser");

		if (user.email_verified_at !== null) {
			return APIResponse.conflict(c, "Email address is already confirmed");
		}

		await DB.instance().transaction(async (tx) => {
			await tx
				.update(DB.Tables.users)
				.set({ email_verified_at: Date.now() })
				.where(eq(DB.Tables.users.id, user.id))
				.run();

			await tx
				.delete(DB.Tables.emailVerifications)
				.where(eq(DB.Tables.emailVerifications.user_id, user.id))
				.run();

			await AuditLog.record(
				{
					actor: authContext,
					action: "user.email_verify",
					targetType: "user",
					targetID: user.id,
					targetLabel: user.username,
				},
				tx,
			);
		});

		return APIResponse.successNoData(c, "Email address marked as confirmed");
	},
);

router.get(
	"/:userId/publishers",

	APIRouteSpec.authenticated({
		summary: "List a user's publishers",
		description: "Publishers the user owns or is a member of, with their role.",
		tags: [DOCS_TAGS.ADMIN_USERS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Publishers retrieved successfully", UsersModel.Publishers.Response),
			APIResponseSpec.notFound("User not found"),
		),
	}),

	async (c) => {
		const user = c.get("targetUser");

		const memberships = await DB.instance()
			.select({
				id: DB.Tables.publishers.id,
				name: DB.Tables.publishers.name,
				display_name: DB.Tables.publishers.display_name,
				verified_at: DB.Tables.publishers.verified_at,
				role: DB.Tables.publisherMembers.role,
				owner_user_id: DB.Tables.publishers.owner_user_id,
			})
			.from(DB.Tables.publisherMembers)
			.innerJoin(
				DB.Tables.publishers,
				eq(DB.Tables.publishers.id, DB.Tables.publisherMembers.publisher_id),
			)
			.where(eq(DB.Tables.publisherMembers.user_id, user.id))
			.orderBy(DB.Tables.publishers.name);

		return APIResponse.success(
			c,
			"Publishers retrieved successfully",
			memberships.map(({ owner_user_id, ...membership }) => ({
				...membership,
				is_owner: owner_user_id === user.id,
			})) satisfies UsersModel.Publishers.Response,
		);
	},
);
