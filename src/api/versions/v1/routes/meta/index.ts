import { and, desc, eq, isNotNull, not, sql } from "drizzle-orm";
import { Hono } from "hono";
import { DB } from "../../../../../db";
import { APIResponse } from "../../../../utils/api-res";
import { EmailService } from "../../../../utils/email";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { SignupUtils } from "../auth/signup";
import { MetaModel } from "./model";

export const router = new Hono().basePath("/meta");

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "Get server features",
		description: "Which optional features this server has enabled, for clients to adapt their UI.",
		tags: [DOCS_TAGS.META],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Server features retrieved successfully", MetaModel.GetInfo.Response),
		),
	}),

	async (c) => {
		return APIResponse.success(c, "Server features retrieved successfully", {
			signup_enabled: SignupUtils.isSignupEnabled(),
			email_enabled: EmailService.isEnabled(),
		} satisfies MetaModel.GetInfo.Response);
	},
);

router.get(
	"/stats",

	APIRouteSpec.unauthenticated({
		summary: "Get public hub statistics",
		description:
			"Counts of listed packages, publishers and releases, and the latest published OS release.",
		tags: [DOCS_TAGS.META],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Statistics retrieved successfully", MetaModel.GetStats.Response),
		),
	}),

	async (c) => {
		const listedPackage = not(
			sql`exists (select 1 from json_each(${DB.Tables.packages.flags}) where value = 'HIDDEN')`,
		);

		const packages = await DB.instance().$count(DB.Tables.packages, listedPackage);
		const publishers = await DB.instance().$count(DB.Tables.publishers);
		const verifiedPublishers = await DB.instance().$count(
			DB.Tables.publishers,
			isNotNull(DB.Tables.publishers.verified_at),
		);
		const releases = await DB.instance().$count(DB.Tables.packageReleases);

		const latestOSRelease = await DB.instance()
			.select({
				version: DB.Tables.os_releases.version,
				published_at: DB.Tables.scheduled_tasks.finished_at,
			})
			.from(DB.Tables.os_releases)
			.innerJoin(
				DB.Tables.scheduled_tasks,
				eq(DB.Tables.scheduled_tasks.id, DB.Tables.os_releases.taskID),
			)
			.where(
				and(
					eq(DB.Tables.scheduled_tasks.status, "completed"),
					isNotNull(DB.Tables.scheduled_tasks.finished_at),
				),
			)
			.orderBy(desc(DB.Tables.scheduled_tasks.finished_at))
			.limit(1)
			.get();

		return APIResponse.success(c, "Statistics retrieved successfully", {
			packages,
			publishers,
			verified_publishers: verifiedPublishers,
			releases,
			latest_os_release: latestOSRelease?.published_at
				? { version: latestOSRelease.version, published_at: latestOSRelease.published_at }
				: null,
		} satisfies MetaModel.GetStats.Response);
	},
);
