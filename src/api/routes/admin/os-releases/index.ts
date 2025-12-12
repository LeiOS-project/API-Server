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

	async (c) => {
		const releases = await DB.instance().select().from(DB.Schema.os_releases);
		return APIResponse.success(c, "OS releases retrieved", releases);
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

	async (c) => {

		const lastRelease = DB.instance().select().from(DB.Schema.os_releases).orderBy(desc(DB.Schema.os_releases.published_at)).limit(1).get();
		if (!lastRelease) {
			throw new Error("No previous OS release found to base delta on");
		}

		const now = new Date(Date.now());

		const version = OSReleaseUtils.getVersionString(now, lastRelease.version);

		const taskID = await TaskScheduler.enqueueTask("os-release:create", {
			pkgReleasesToIncludeByID: await RuntimeMetadata.getOSReleasePendingPackages(),
			version,
			timestamp: now.getTime()
		}, { created_by_user_id: null });

		return APIResponse.accepted(c, "OS release creation task enqueued", {
			taskID,
			version
		});
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
			APIResponseSpec.success("OS release retrieved", OSReleasesModel.GetByVersion.Response)
		)
	}),

	async (c) => {
		// @ts-ignore
		const release = c.get("osRelease") as DB.Models.OSRelease;

		return APIResponse.success(c, "OS release retrieved", release);
	}
);