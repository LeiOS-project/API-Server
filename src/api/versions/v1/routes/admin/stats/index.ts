import { eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { AdminStatsModel } from "./model";

export const router = new Hono().basePath("/stats");

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "Get admin overview statistics",
		description: "Counts for the admin dashboard: users, publishers, packages and open work queues.",
		tags: [DOCS_TAGS.ADMIN_OVERVIEW],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Statistics retrieved successfully", AdminStatsModel.Get.Response),
		),
	}),

	async (c) => {
		const db = DB.instance();
		const hasFlag = (flag: string) =>
			sql`exists (select 1 from json_each(${DB.Tables.packages.flags}) where value = ${flag})`;
		const taskStatus = (status: DB.Models.ScheduledTask["status"]) =>
			db.$count(DB.Tables.scheduled_tasks, eq(DB.Tables.scheduled_tasks.status, status));

		return APIResponse.success(c, "Statistics retrieved successfully", {
			users: {
				total: await db.$count(DB.Tables.users),
				suspended: await db.$count(DB.Tables.users, eq(DB.Tables.users.status, "suspended")),
				unverified: await db.$count(DB.Tables.users, isNull(DB.Tables.users.email_verified_at)),
				new_last_7_days: await db.$count(
					DB.Tables.users,
					gte(DB.Tables.users.created_at, Date.now() - 7 * 24 * 60 * 60 * 1000),
				),
			},
			publishers: {
				total: await db.$count(DB.Tables.publishers),
				verified: await db.$count(DB.Tables.publishers, isNotNull(DB.Tables.publishers.verified_at)),
			},
			packages: {
				total: await db.$count(DB.Tables.packages),
				hidden: await db.$count(DB.Tables.packages, hasFlag("HIDDEN")),
				deprecated: await db.$count(DB.Tables.packages, hasFlag("DEPRECATED")),
			},
			releases: await db.$count(DB.Tables.packageReleases),
			stable_promotion_requests_pending: await db.$count(
				DB.Tables.stablePromotionRequests,
				eq(DB.Tables.stablePromotionRequests.status, "pending"),
			),
			stable_queue: await db.$count(
				DB.Tables.stablePromotionRequests,
				eq(DB.Tables.stablePromotionRequests.status, "queued"),
			),
			reports_open: await db.$count(DB.Tables.reports, eq(DB.Tables.reports.status, "open")),
			tasks: {
				running: await taskStatus("running"),
				pending: await taskStatus("pending"),
				failed: await taskStatus("failed"),
			},
		} satisfies AdminStatsModel.Get.Response);
	},
);
