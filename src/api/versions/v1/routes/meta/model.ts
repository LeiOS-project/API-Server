import z from "zod";

export namespace MetaModel.GetInfo {
	export const Response = z.object({
		/** Whether POST /auth/signup is open (needs both LRA_SIGNUP_ENABLED and email). */
		signup_enabled: z.boolean(),
		/** Whether the server can send email (password reset, verification). */
		email_enabled: z.boolean(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace MetaModel.GetStats {
	export const Response = z.object({
		packages: z.number().int(),
		publishers: z.number().int(),
		verified_publishers: z.number().int(),
		releases: z.number().int(),
		latest_os_release: z
			.object({
				version: z.string(),
				published_at: z.number().int(),
			})
			.nullable(),
	});
	export type Response = z.infer<typeof Response>;
}
