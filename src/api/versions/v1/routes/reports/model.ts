import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import { DB } from "../../../../../db";
import { ModerationSettings } from "../../../../utils/shared-models/moderation";

export namespace ReportsModel {
	export const Entity = createSelectSchema(DB.Tables.reports, {
		target_type: ModerationSettings.ReportTargetType,
		reason: ModerationSettings.ReportReason,
		status: ModerationSettings.ReportStatus,
	});
	export type Entity = z.infer<typeof Entity>;
}

export namespace ReportsModel.Create {
	export const Body = z.object({
		target_type: ModerationSettings.ReportTargetType,
		/** Package fullname (`publisher.package`) or publisher name. */
		target_name: z.string().min(1).max(256),
		reason: ModerationSettings.ReportReason,
		details: z.string().max(2000).default(""),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		id: z.number().int(),
	});
	export type Response = z.infer<typeof Response>;
}
