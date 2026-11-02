import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { EmailVerificationHandler } from "../../../../../utils/emailVerification";
import { RateLimiter } from "../../../../../utils/rateLimiter";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { VerifyEmailModel } from "./model";

const verifyAttemptsPerToken = new RateLimiter(5, 15 * 60 * 1000); // 5 per 15 minutes
const resendAttemptsPerEmail = new RateLimiter(1, 5 * 60 * 1000); // 1 per 5 minutes

export const router = new Hono().basePath("/verify-email");

router.post(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Confirm an email address",
		description:
			"Consume the token from a verification email. Works signed in or signed out, so the link can be opened anywhere.",
		tags: [DOCS_TAGS.AUTHENTICATION],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Email address confirmed"),
			APIResponseSpec.badRequest("Invalid or expired verification token"),
			APIResponseSpec.conflict("This email address is already used by another account"),
		),
	}),

	zValidator("json", VerifyEmailModel.Verify.Body),

	async (c) => {
		const { token } = c.req.valid("json");

		const tokenKey = EmailVerificationHandler.hashToken(token);
		if (!verifyAttemptsPerToken.hit(tokenKey)) {
			return APIResponse.badRequest(c, "Invalid or expired verification token");
		}

		const result = await EmailVerificationHandler.consume(token);

		if (result.status === "invalid") {
			return APIResponse.badRequest(c, "Invalid or expired verification token");
		}
		if (result.status === "conflict") {
			return APIResponse.conflict(c, "This email address is already used by another account");
		}

		return APIResponse.successNoData(c, "Email address confirmed");
	},
);

router.post(
	"/resend",

	APIRouteSpec.unauthenticated({
		summary: "Resend the verification email",
		description:
			"Send a new verification link to an account whose email address is not confirmed yet. Always answers the same way, so it does not reveal which addresses have accounts.",
		tags: [DOCS_TAGS.AUTHENTICATION],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData(
				"If an unconfirmed account uses this address, a new verification email has been sent",
			),
		),
	}),

	zValidator("json", VerifyEmailModel.Resend.Body),

	async (c) => {
		const email = c.req.valid("json").email.toLowerCase();

		if (resendAttemptsPerEmail.hit(email)) {
			const user = await DB.instance()
				.select({ id: DB.Tables.users.id, email: DB.Tables.users.email })
				.from(DB.Tables.users)
				.where(and(eq(DB.Tables.users.email, email), isNull(DB.Tables.users.email_verified_at)))
				.get();

			if (user) {
				await EmailVerificationHandler.start(user.id, user.email, "signup");
			}
		}

		return APIResponse.successNoData(
			c,
			"If an unconfirmed account uses this address, a new verification email has been sent",
		);
	},
);
