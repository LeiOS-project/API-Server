import { createHash as crypto_createHash, randomBytes as crypto_randomBytes } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
import { EmailService } from "./email";

/** Email address verification: tokens are emailed on signup and on an email change. */
export class EmailVerificationHandler {
	static readonly TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

	/** sha256 hex — the stored form of a token, so the row can be looked up by it. */
	static hashToken(rawToken: string) {
		return crypto_createHash("sha256").update(rawToken).digest("hex");
	}

	/**
	 * Replaces the user's pending verification with a new one for `email` and emails the link.
	 * Returns false when email is disabled (the token is still stored so an admin flow could use it).
	 */
	static async start(
		userID: number,
		email: string,
		kind: EmailVerificationHandler.Kind,
		tx: DrizzleDB = DB.instance(),
	) {
		const rawToken = crypto_randomBytes(48).toString("hex");

		await tx
			.delete(DB.Tables.emailVerifications)
			.where(eq(DB.Tables.emailVerifications.user_id, userID))
			.run();

		await tx
			.insert(DB.Tables.emailVerifications)
			.values({
				token: EmailVerificationHandler.hashToken(rawToken),
				user_id: userID,
				email,
				expires_at: Date.now() + EmailVerificationHandler.TOKEN_TTL_MS,
			})
			.run();

		if (!EmailService.isEnabled()) return false;

		await EmailService.sendEmailVerificationEmail(email, rawToken, kind);
		return true;
	}

	/**
	 * Consumes a token: marks the address as verified (and makes it the account's email if it was
	 * a pending change). Returns the result kind; tokens are single-use.
	 */
	static async consume(rawToken: string): Promise<EmailVerificationHandler.ConsumeResult> {
		const tokenHash = EmailVerificationHandler.hashToken(rawToken);

		return await DB.instance().transaction(async (tx) => {
			const verification = await tx
				.select()
				.from(DB.Tables.emailVerifications)
				.where(eq(DB.Tables.emailVerifications.token, tokenHash))
				.get();

			if (!verification || verification.expires_at < Date.now()) {
				return { status: "invalid" } as const;
			}

			const takenByOther = await tx
				.select({ id: DB.Tables.users.id })
				.from(DB.Tables.users)
				.where(
					and(
						eq(DB.Tables.users.email, verification.email),
						ne(DB.Tables.users.id, verification.user_id),
					),
				)
				.get();

			if (takenByOther) {
				return { status: "conflict" } as const;
			}

			await tx
				.update(DB.Tables.users)
				.set({ email: verification.email, email_verified_at: Date.now() })
				.where(eq(DB.Tables.users.id, verification.user_id))
				.run();

			await tx
				.delete(DB.Tables.emailVerifications)
				.where(eq(DB.Tables.emailVerifications.user_id, verification.user_id))
				.run();

			return { status: "verified", userID: verification.user_id } as const;
		});
	}
}

export namespace EmailVerificationHandler {
	export type Kind = "signup" | "change";

	export type ConsumeResult =
		| { status: "verified"; userID: number }
		| { status: "invalid" }
		| { status: "conflict" };
}
