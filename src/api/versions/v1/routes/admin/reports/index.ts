import { and, asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { AdminReportsModel } from "./model";

export const router = new Hono().basePath("/reports");

const reporter = alias(DB.Tables.users, "reporter");
const resolver = alias(DB.Tables.users, "resolver");

/** Reports joined with the reporter's and resolver's usernames. */
function reportsQuery() {
	return DB.instance()
		.select({
			id: DB.Tables.reports.id,
			reporter_user_id: DB.Tables.reports.reporter_user_id,
			target_type: DB.Tables.reports.target_type,
			target_id: DB.Tables.reports.target_id,
			target_label: DB.Tables.reports.target_label,
			reason: DB.Tables.reports.reason,
			details: DB.Tables.reports.details,
			status: DB.Tables.reports.status,
			resolution_note: DB.Tables.reports.resolution_note,
			resolved_by_user_id: DB.Tables.reports.resolved_by_user_id,
			resolved_at: DB.Tables.reports.resolved_at,
			created_at: DB.Tables.reports.created_at,

			reporter_username: reporter.username,
			resolved_by_username: resolver.username,
		})
		.from(DB.Tables.reports)
		.leftJoin(reporter, eq(reporter.id, DB.Tables.reports.reporter_user_id))
		.leftJoin(resolver, eq(resolver.id, DB.Tables.reports.resolved_by_user_id))
		.$dynamic();
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List reports",
		description: "User reports about packages and publishers, newest first by default.",
		tags: [DOCS_TAGS.ADMIN_REPORTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Reports retrieved successfully", AdminReportsModel.GetAll.Response),
		),
	}),

	zValidator("query", AdminReportsModel.GetAll.Query),

	async (c) => {
		const { limit, offset, order, status, target_type } = c.req.valid("query");

		const where = and(
			status ? eq(DB.Tables.reports.status, status) : undefined,
			target_type ? eq(DB.Tables.reports.target_type, target_type) : undefined,
		);

		const items = await reportsQuery()
			.where(where)
			.orderBy(
				order === "newest" ? desc(DB.Tables.reports.created_at) : asc(DB.Tables.reports.created_at),
				desc(DB.Tables.reports.id),
			)
			.limit(limit)
			.offset(offset);

		const total = await DB.instance().$count(DB.Tables.reports, where);

		return APIResponse.success(c, "Reports retrieved successfully", {
			items,
			total,
		} satisfies AdminReportsModel.GetAll.Response);
	},
);

router.get(
	"/:reportId",

	APIRouteSpec.authenticated({
		summary: "Get report",
		description: "Retrieve one report.",
		tags: [DOCS_TAGS.ADMIN_REPORTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Report retrieved successfully", AdminReportsModel.Entity),
			APIResponseSpec.notFound("Report not found"),
		),
	}),

	zValidator("param", AdminReportsModel.Param),

	async (c) => {
		const { reportId } = c.req.valid("param");

		const report = await reportsQuery().where(eq(DB.Tables.reports.id, reportId)).get();
		if (!report) {
			return APIResponse.notFound(c, "Report not found");
		}

		return APIResponse.success(
			c,
			"Report retrieved successfully",
			report satisfies AdminReportsModel.Entity,
		);
	},
);

router.post(
	"/:reportId/resolve",

	APIRouteSpec.authenticated({
		summary: "Resolve report",
		description:
			"Close a report as resolved (action taken) or dismissed (no action needed), with a note.",
		tags: [DOCS_TAGS.ADMIN_REPORTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Report closed"),
			APIResponseSpec.notFound("Report not found"),
			APIResponseSpec.conflict("Report is already closed"),
		),
	}),

	zValidator("param", AdminReportsModel.Param),
	zValidator("json", AdminReportsModel.Resolve.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		if (authContext.type === "unauthenticated") {
			return APIResponse.unauthorized(c, "Authentication required");
		}

		const { reportId } = c.req.valid("param");
		const { status, note } = c.req.valid("json");

		const report = await DB.instance()
			.select()
			.from(DB.Tables.reports)
			.where(eq(DB.Tables.reports.id, reportId))
			.get();

		if (!report) {
			return APIResponse.notFound(c, "Report not found");
		}
		if (report.status !== "open") {
			return APIResponse.conflict(c, "Report is already closed");
		}

		await DB.instance().transaction(async (tx) => {
			await tx
				.update(DB.Tables.reports)
				.set({
					status,
					resolution_note: note,
					resolved_by_user_id: authContext.user_id,
					resolved_at: Date.now(),
				})
				.where(eq(DB.Tables.reports.id, report.id))
				.run();

			await AuditLog.record(
				{
					actor: authContext,
					action: `report.${status === "resolved" ? "resolve" : "dismiss"}`,
					targetType: "report",
					targetID: report.id,
					targetLabel: `${report.target_type} ${report.target_label}`,
					metadata: { note },
				},
				tx,
			);
		});

		return APIResponse.successNoData(c, "Report closed");
	},
);
