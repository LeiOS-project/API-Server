import { eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { ConfigHandler } from "../../../../../../utils/config";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { EmailService } from "../../../../../utils/email";
import { EmailVerificationHandler } from "../../../../../utils/emailVerification";
import { RateLimiter } from "../../../../../utils/rateLimiter";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { SignupModel } from "./model";

const SIGNUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const signupAttemptsPerClient = new RateLimiter(10, SIGNUP_WINDOW_MS);
const signupAttemptsPerEmail = new RateLimiter(3, SIGNUP_WINDOW_MS);

export class SignupUtils {
	/** Signup needs email verification, so it is only open while email is configured as well. */
	static isSignupEnabled() {
		return ConfigHandler.getConfig()?.SIGNUP_ENABLED === true && EmailService.isEnabled();
	}
}

export const router = new Hono().basePath("/signup");

router.post(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Sign up",
		description:
			"Create a new account. The account can sign in right away, but some actions (like creating a publisher) need the email address to be confirmed through the link that is emailed.",
		tags: [DOCS_TAGS.AUTHENTICATION],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created(
				"Account created. Check your inbox to confirm your email address.",
				SignupModel.Signup.Response,
			),
			APIResponseSpec.forbidden("Signup is disabled / You are already authenticated"),
			APIResponseSpec.conflict("Username already taken / Email already in use"),
			APIResponseSpec.tooManyRequests("Too many signup attempts. Try again later."),
		),
	}),

	zValidator("json", SignupModel.Signup.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		if (authContext.type !== "unauthenticated") {
			return APIResponse.forbidden(c, "You are already authenticated");
		}

		if (!SignupUtils.isSignupEnabled()) {
			return APIResponse.forbidden(c, "Signup is disabled");
		}

		const body = c.req.valid("json");
		const email = body.email.toLowerCase();

		const clientKey = RateLimiter.clientId(c);
		if (!signupAttemptsPerClient.hit(clientKey) || !signupAttemptsPerEmail.hit(email)) {
			c.header("Retry-After", signupAttemptsPerClient.retryAfterSeconds(clientKey).toString());
			return APIResponse.tooManyRequests(c, "Too many signup attempts. Try again later.");
		}

		const existing = await DB.instance()
			.select({ username: DB.Tables.users.username, email: DB.Tables.users.email })
			.from(DB.Tables.users)
			.where(or(eq(DB.Tables.users.username, body.username), eq(DB.Tables.users.email, email)))
			.all();

		if (existing.some((user) => user.username === body.username)) {
			return APIResponse.conflict(c, "Username already taken");
		}
		if (existing.length > 0) {
			return APIResponse.conflict(c, "Email already in use");
		}

		const passwordHash = await Bun.password.hash(body.password);

		const user = await DB.instance().transaction(async (tx) => {
			const created = await tx
				.insert(DB.Tables.users)
				.values({
					username: body.username,
					display_name: body.display_name,
					email,
					password_hash: passwordHash,
					role: "user",
				})
				.returning()
				.get();

			await AuditLog.record(
				{
					actor: created.id,
					action: "user.signup",
					targetType: "user",
					targetID: created.id,
					targetLabel: created.username,
				},
				tx,
			);

			await EmailVerificationHandler.start(created.id, email, "signup", tx);

			return created;
		});

		return APIResponse.created(
			c,
			"Account created. Check your inbox to confirm your email address.",
			{
				id: user.id,
				username: user.username,
				display_name: user.display_name,
				email: user.email,
				email_verified_at: user.email_verified_at,
			} satisfies SignupModel.Signup.Response,
		);
	},
);
