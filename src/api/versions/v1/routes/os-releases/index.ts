import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../db";
import { APIResponse } from "../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { PublicOSReleasesModel } from "./model";

export const router = new Hono().basePath("/os-releases");

/** Only OS releases whose publishing task finished are public. */
function publishedReleasesQuery() {
	return DB.instance()
		.select({
			version: DB.Tables.os_releases.version,
			changelog: DB.Tables.os_releases.changelog,
			published_at: DB.Tables.scheduled_tasks.finished_at,
		})
		.from(DB.Tables.os_releases)
		.innerJoin(
			DB.Tables.scheduled_tasks,
			eq(DB.Tables.scheduled_tasks.id, DB.Tables.os_releases.taskID),
		)
		.$dynamic();
}

const isPublished = and(
	eq(DB.Tables.scheduled_tasks.status, "completed"),
	isNotNull(DB.Tables.scheduled_tasks.finished_at),
);

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "List published OS releases",
		description: "Retrieve the published LeiOS releases with their changelogs.",
		tags: [DOCS_TAGS.OS_RELEASES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"OS releases retrieved successfully",
				PublicOSReleasesModel.GetAll.Response,
			),
		),
	}),

	zValidator("query", PublicOSReleasesModel.GetAll.Query),

	async (c) => {
		const { limit, offset, order } = c.req.valid("query");

		const items = await publishedReleasesQuery()
			.where(isPublished)
			.orderBy(
				order === "newest"
					? desc(DB.Tables.scheduled_tasks.finished_at)
					: asc(DB.Tables.scheduled_tasks.finished_at),
			)
			.limit(limit)
			.offset(offset);

		const total = await DB.instance().$count(
			DB.instance()
				.select({ id: DB.Tables.os_releases.id })
				.from(DB.Tables.os_releases)
				.innerJoin(
					DB.Tables.scheduled_tasks,
					eq(DB.Tables.scheduled_tasks.id, DB.Tables.os_releases.taskID),
				)
				.where(isPublished)
				.as("published_os_releases"),
		);

		return APIResponse.success(c, "OS releases retrieved successfully", {
			items: items as PublicOSReleasesModel.Entity[],
			total,
		} satisfies PublicOSReleasesModel.GetAll.Response);
	},
);

router.get(
	"/:version",

	APIRouteSpec.unauthenticated({
		summary: "Get a published OS release",
		description: "Retrieve one published LeiOS release by version (YYYY.MM.NNN).",
		tags: [DOCS_TAGS.OS_RELEASES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"OS release retrieved successfully",
				PublicOSReleasesModel.GetByVersion.Response,
			),
			APIResponseSpec.notFound("OS release not found"),
		),
	}),

	zValidator("param", PublicOSReleasesModel.Param),

	async (c) => {
		const { version } = c.req.valid("param");

		const release = await publishedReleasesQuery()
			.where(and(isPublished, eq(DB.Tables.os_releases.version, version)))
			.get();

		if (!release) {
			return APIResponse.notFound(c, "OS release not found");
		}

		return APIResponse.success(
			c,
			"OS release retrieved successfully",
			release as PublicOSReleasesModel.GetByVersion.Response,
		);
	},
);
