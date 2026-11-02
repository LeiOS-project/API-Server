import type { TaskHandler } from "@cleverjs/utils";
import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../../db";
import { ApiHelperModels } from "../../../../../utils/shared-models/api-helper-models";

export namespace OSReleasesModel {
	export const Param = z.object({
		version: z.string().regex(/^\d{4}\.\d{2}\.\d{3}$/),
	});

	export const Changelog = z
		.string()
		.min(1, "Changelog cannot be empty")
		.max(10000, "Changelog cannot exceed 10,000 characters")
		.describe("Markdown");

	/** Stable promotion requests to include; each must be queued. */
	export const RequestIDs = z
		.array(z.number().int().positive())
		.max(1000)
		.refine((ids) => new Set(ids).size === ids.length, "Request ids must be unique")
		.describe("Ids of queued stable promotion requests");

	export const Entity = createSelectSchema(DB.Tables.os_releases, { changelog: Changelog })
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
			package_count: z.number().int().describe("Package releases this OS release moves into stable"),
		})
		.omit({
			taskID: true,
		});
	export type Entity = z.infer<typeof Entity>;

	export const Package = z.object({
		package_release_id: z.number().int().nullable().describe("null once the release was deleted"),
		package_fullname: z.string(),
		version_with_leios_patch: z.string(),
	});
	export type Package = z.infer<typeof Package>;
}

export namespace OSReleasesModel.GetByVersion {
	export const Response = OSReleasesModel.Entity.extend({
		packages: z.array(OSReleasesModel.Package),
	});

	export type Response = z.infer<typeof Response>;
}

export namespace OSReleasesModel.GetAll {
	export const Response = ApiHelperModels.Paginated(OSReleasesModel.Entity);

	export type Response = z.infer<typeof Response>;
}

export namespace OSReleasesModel.CreateRelease {
	export const Body = z.object({
		changelog: OSReleasesModel.Changelog,
		stable_promotion_request_ids: OSReleasesModel.RequestIDs,
	});

	export type Body = z.infer<typeof Body>;

	export const Response = OSReleasesModel.GetByVersion.Response;

	export type Response = z.infer<typeof Response>;
}

export namespace OSReleasesModel.GenerateChangelog {
	export const Body = z.object({
		stable_promotion_request_ids: OSReleasesModel.RequestIDs,
	});
	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		version: z.string().describe("The version the next OS release would get"),
		changelog: z.string().describe("Markdown release notes for the selected releases"),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace OSReleasesModel.GetPublishingLogs {
	export const Response = z.object({
		logs: z.string(),
	});

	export type Response = z.infer<typeof Response>;
}

export namespace OSReleasesModel.UpdateRelease {
	export const Body = z.object({
		changelog: OSReleasesModel.Changelog.optional(),
	});

	export type Body = z.infer<typeof Body>;
}
