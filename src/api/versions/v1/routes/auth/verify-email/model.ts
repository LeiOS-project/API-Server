import z from "zod";

export namespace VerifyEmailModel.Verify {
	export const Body = z.object({
		token: z.string().min(1).max(256),
	});
	export type Body = z.infer<typeof Body>;
}

export namespace VerifyEmailModel.Resend {
	export const Body = z.object({
		email: z.email(),
	});
	export type Body = z.infer<typeof Body>;
}
