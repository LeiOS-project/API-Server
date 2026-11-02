import z from "zod";

export namespace AdminStatsModel.Get {
	export const Response = z.object({
		users: z.object({
			total: z.number().int(),
			suspended: z.number().int(),
			unverified: z.number().int(),
			new_last_7_days: z.number().int(),
		}),
		publishers: z.object({
			total: z.number().int(),
			verified: z.number().int(),
		}),
		packages: z.object({
			total: z.number().int(),
			hidden: z.number().int(),
			deprecated: z.number().int(),
		}),
		releases: z.number().int(),
		stable_promotion_requests_pending: z.number().int(),
		stable_queue: z.number().int().describe("Releases queued for the next OS release"),
		reports_open: z.number().int(),
		tasks: z.object({
			running: z.number().int(),
			pending: z.number().int(),
			failed: z.number().int(),
		}),
	});
	export type Response = z.infer<typeof Response>;
}
