import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { OSReleasesModel } from "./model";
import { DB } from "../../../../db";
import { APIResponse } from "../../../utils/api-res";
import { eq, desc } from "drizzle-orm";
import { TaskScheduler } from "../../../../tasks";
import { RuntimeMetadata } from "../../../utils/metadata";
import { OSReleaseUtils } from "../../../utils/os-release-utils";
import { ApiHelperModels } from "../../../utils/shared-models/api-helper-models";
import { TaskHandler } from "@cleverjs/utils";
import { TaskUtils } from "../../../../tasks/utils";

export const router = new Hono().basePath('/os-releases');

router.get('/',

	APIRouteSpec.authenticated({
		summary: "List OS releases",
		description: "Retrieve all OS releases.",
		tags: [DOCS_TAGS.ADMIN_API.OS_RELEASES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("OS releases retrieved", OSReleasesModel.GetAll.Response)
		)
	}),

	zValidator("query", ApiHelperModels.ListAll.Query),

	async (c) => {
		const { limit, offset, order } = c.req.valid("query");

		const releases = await DB.instance().select({
			id: DB.Schema.os_releases.id,
			version: DB.Schema.os_releases.version,
			changelog: DB.Schema.os_releases.changelog,
			created_at: DB.Schema.os_releases.created_at,

			published_at: DB.Schema.scheduled_tasks.finished_at,
			publishing_status: DB.Schema.scheduled_tasks.status,
		})
		.from(DB.Schema.os_releases)
		.innerJoin(
			DB.Schema.scheduled_tasks,
			eq(DB.Schema.scheduled_tasks.id, DB.Schema.os_releases.taskID)
		)
		.orderBy(
			order === "newest" ?
				desc(DB.Schema.os_releases.created_at) :
				DB.Schema.os_releases.created_at
		)
		.limit(limit)
		.offset(offset);

		return APIResponse.success(c, "OS releases retrieved", releases satisfies OSReleasesModel.GetAll.Response);
	}
);

router.post('/',

	APIRouteSpec.authenticated({
		summary: "Create OS release (async)",
		description: "Enqueue creation of an OS release and publishing to the live repo.",
		tags: [DOCS_TAGS.ADMIN_API.OS_RELEASES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.accepted("OS release creation task enqueued", OSReleasesModel.CreateRelease.Response)
		)
	}),

	zValidator('json', OSReleasesModel.CreateRelease.Body),

	async (c) => {

		const newReleaseData = c.req.valid('json');
		
		let lastReleaseVersion = DB.instance().select().from(DB.Schema.os_releases).orderBy(desc(DB.Schema.os_releases.created_at)).limit(1).get()?.version;
		if (!lastReleaseVersion) {
			// check if any releases exist at all
			const anyRelease = DB.instance().select().from(DB.Schema.os_releases).limit(1).get();
			if (!anyRelease) {
				lastReleaseVersion = "0000.00.0";
			}
		}

		const now = new Date(Date.now());

		const version = OSReleaseUtils.getVersionString(now, lastReleaseVersion as string);

		const taskID = await TaskScheduler.enqueueTask("os-release:create", {
			pkgReleasesToIncludeByID: await RuntimeMetadata.getOSReleasePendingPackages(),
			version,
			timestamp: now.getTime(),
		}, {
			created_by_user_id: null
		}, {
			storeLogs: true
		});

		const result = {
			...await DB.instance().insert(DB.Schema.os_releases).values({
				version,
				changelog: newReleaseData.changelog,
				taskID,
			}).returning().get(),
			published_at: null,
			publishing_status: "pending"
		} as const;

		return APIResponse.accepted(c, "OS release creation task enqueued", result satisfies OSReleasesModel.CreateRelease.Response);
	}
);

router.use('/:version/*',
	
	zValidator('param', OSReleasesModel.Param),
	
	async (c, next) => {
		// @ts-ignore
		const { version } = c.req.valid("param") as { version: string };

		const release = await DB.instance().select().from(DB.Schema.os_releases).where(
			eq(DB.Schema.os_releases.version, version)
		).get();

		if (!release) {
			return APIResponse.notFound(c, "OS release not found");
		}

		// @ts-ignore
		c.set("osRelease", release);

		await next();
	}
);

router.get('/:version',

	APIRouteSpec.authenticated({
		summary: "Get OS release",
		description: "Retrieve a specific OS release by version.",
		tags: [DOCS_TAGS.ADMIN_API.OS_RELEASES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("OS release retrieved", OSReleasesModel.GetByVersion.Response),
			APIResponseSpec.notFound("OS release not found")
		)
	}),

	async (c) => {
		// @ts-ignore
		const release = c.get("osRelease") as DB.Models.OSRelease;

		const task = await DB.instance().select().from(DB.Schema.scheduled_tasks).where(
			eq(DB.Schema.scheduled_tasks.id, release.taskID)
		).get();

		if (!task) {
			return APIResponse.serverError(c, "Associated publishing task not found for this OS release");
		}

		const result = {
			...release,
			published_at: task.finished_at,
			publishing_status: task.status
		};

		return APIResponse.success(c, "OS release retrieved", result satisfies OSReleasesModel.GetByVersion.Response);
	}
);

router.get('/:version/publishing-logs',

	APIRouteSpec.authenticated({
		summary: "Get OS release publishing logs",
		description: "Retrieve publishing logs of a specific OS release by version.",
		tags: [DOCS_TAGS.ADMIN_API.OS_RELEASES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Publishing logs retrieved", OSReleasesModel.GetPublishingLogs.Response),
			APIResponseSpec.notFound("OS release not found / Log file not found for this OS release publishing task")
		)
	}),

	async (c) => {
		// @ts-ignore
		const release = c.get("osRelease") as DB.Models.OSRelease;

		const logs = await TaskUtils.getLogsForTask(release.taskID);

		if (logs === null) {
			return APIResponse.notFound(c, "Log file not found for this OS release publishing task");
		}

		return APIResponse.success(c, "Publishing logs retrieved", { logs } satisfies OSReleasesModel.GetPublishingLogs.Response);
	}
);

router.put('/:version',

	APIRouteSpec.authenticated({
		summary: "Update OS release",
		description: "Update details of a specific OS release by version.",
		tags: [DOCS_TAGS.ADMIN_API.OS_RELEASES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("OS release updated successfully"),
			APIResponseSpec.notFound("OS release not found")
		)
	}),

	zValidator('json', OSReleasesModel.UpdateRelease.Body),

	async (c) => {
		// @ts-ignore
		const release = c.get("osRelease") as DB.Models.OSRelease;

		const updateData = c.req.valid('json');

		await DB.instance().update(DB.Schema.os_releases).set(updateData).where(
			eq(DB.Schema.os_releases.id, release.id)
		);

		return APIResponse.successNoData(c, "OS release updated successfully");
	}
);