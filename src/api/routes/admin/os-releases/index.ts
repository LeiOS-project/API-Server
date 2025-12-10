import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { OSReleases } from "./model";
import { DB } from "../../../../db";
import { APIResponse } from "../../../utils/api-res";
import { eq } from "drizzle-orm";
import { TaskScheduler } from "../../../../tasks";

export const router = new Hono().basePath('/os-releases');

router.get('/',

	APIRouteSpec.authenticated({
		summary: "List OS releases",
		description: "Retrieve all OS releases.",
		tags: [DOCS_TAGS.ADMIN_API.OS_RELEASES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("OS releases retrieved", OSReleases.GetAll.Response)
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
			// APIResponse
		)
	}),

	zValidator("json", z.object({
		version: z.string().min(1)
	})),

	async (c) => {
		const { version } = c.req.valid("json");

		const existing = DB.instance().select().from(DB.Schema.os_releases).where(eq(DB.Schema.os_releases.version, version)).get();
		if (existing) {
			return APIResponse.conflict(c, "OS release with this version already exists");
		}

		const task = await TaskScheduler.enqueue("os-release:create", { version });

		return APIResponse.accepted(c, "OS release queued", {
			taskId: task.id,
			status: "queued" as const,
			pollUrl: `/tasks/${task.id}`
		});
	}
);