import z from "zod";
import { ApiHelperModels } from "../../../../../utils/shared-models/api-helper-models";
import { ModerationSettings } from "../../../../../utils/shared-models/moderation";
import { ReportsModel } from "../../reports/model";

export namespace AdminReportsModel {
	export const Param = z.object({
		reportId: z.coerce.number().int().positive(),
	});

	export const Entity = ReportsModel.Entity.extend({
		reporter_username: z.string().nullable(),
		resolved_by_username: z.string().nullable(),
	});
	export type Entity = z.infer<typeof Entity>;
}

export namespace AdminReportsModel.GetAll {
	export const Query = ApiHelperModels.ListAll.Query.extend({
		status: ModerationSettings.ReportStatus.optional(),
		target_type: ModerationSettings.ReportTargetType.optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = ApiHelperModels.Paginated(AdminReportsModel.Entity);
	export type Response = z.infer<typeof Response>;
}

export namespace AdminReportsModel.Resolve {
	export const Body = z.object({
		status: z.enum(["resolved", "dismissed"]),
		note: z.string().max(2000).default(""),
	});
	export type Body = z.infer<typeof Body>;
}
