import type { TaskHandler } from "@cleverjs/utils";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { ApiHelperModels } from "../../../../../utils/shared-models/api-helper-models";

export namespace OSReleasesModel {
	export const Param = z.object({
		version: z.string().regex(/^\d{4}\.\d{2}\.\d{3}$/),
	});
}

export namespace OSReleasesModel.GetByVersion {
	export const Response = createSelectSchema(DB.Tables.os_releases)
		.extend({
			published_at: z.number().nullable(),
			// `satisfies` keeps this list from listing a status the task handler does not have.
			publishing_status: z.enum([
				"pending",
				"running",
				"paused",
				"failed",
				"completed",
			]) satisfies z.ZodType<TaskHandler.BaseTaskData<{}>["status"]>,
		})
		.omit({
			taskID: true,
		});

	export type Response = z.infer<typeof Response>;
}

export namespace OSReleasesModel.GetAll {
	export const Response = ApiHelperModels.Paginated(OSReleasesModel.GetByVersion.Response);

	export type Response = z.infer<typeof Response>;
}

export namespace OSReleasesModel.CreateRelease {
	export const Body = createInsertSchema(DB.Tables.os_releases, {
		changelog: z
			.string()
			.min(1, "Changelog cannot be empty")
			.max(10000, "Changelog cannot exceed 10,000 characters"),
	}).omit({
		id: true,
		created_at: true,
		taskID: true,
		version: true,
	});

	export type Body = z.infer<typeof Body>;

	export const Response = OSReleasesModel.GetByVersion.Response;

	export type Response = z.infer<typeof Response>;
}

export namespace OSReleasesModel.GetPublishingLogs {
	export const Response = z.object({
		logs: z.string(),
	});

	export type Response = z.infer<typeof Response>;
}

export namespace OSReleasesModel.UpdateRelease {
	export const Body = OSReleasesModel.CreateRelease.Body.partial();

	export type Body = z.infer<typeof Body>;
}
