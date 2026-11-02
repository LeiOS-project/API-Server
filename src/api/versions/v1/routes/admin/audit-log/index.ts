import { and, asc, desc, eq, like } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { AuditLogModel } from "./model";

export const router = new Hono().basePath("/audit-log");

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List audit log entries",
		description:
			"Who did what to which resource — admin actions, publisher management, signups and reports.",
		tags: [DOCS_TAGS.ADMIN_AUDIT_LOG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Audit log retrieved successfully", AuditLogModel.GetAll.Response),
		),
	}),

	zValidator("query", AuditLogModel.GetAll.Query),

	async (c) => {
		const { limit, offset, order, actor_user_id, action, target_type, target_id } =
			c.req.valid("query");

		const where = and(
			actor_user_id ? eq(DB.Tables.auditLog.actor_user_id, actor_user_id) : undefined,
			action
				? action.endsWith(".")
					? like(DB.Tables.auditLog.action, `${action}%`)
					: eq(DB.Tables.auditLog.action, action)
				: undefined,
			target_type ? eq(DB.Tables.auditLog.target_type, target_type) : undefined,
			target_id ? eq(DB.Tables.auditLog.target_id, target_id) : undefined,
		);

		const items = await DB.instance()
			.select({
				id: DB.Tables.auditLog.id,
				actor_user_id: DB.Tables.auditLog.actor_user_id,
				action: DB.Tables.auditLog.action,
				target_type: DB.Tables.auditLog.target_type,
				target_id: DB.Tables.auditLog.target_id,
				target_label: DB.Tables.auditLog.target_label,
				metadata: DB.Tables.auditLog.metadata,
				created_at: DB.Tables.auditLog.created_at,
				actor_username: DB.Tables.users.username,
			})
			.from(DB.Tables.auditLog)
			.leftJoin(DB.Tables.users, eq(DB.Tables.users.id, DB.Tables.auditLog.actor_user_id))
			.where(where)
			.orderBy(order === "newest" ? desc(DB.Tables.auditLog.id) : asc(DB.Tables.auditLog.id))
			.limit(limit)
			.offset(offset);

		const total = await DB.instance().$count(DB.Tables.auditLog, where);

		return APIResponse.success(c, "Audit log retrieved successfully", {
			items,
			total,
		} satisfies AuditLogModel.GetAll.Response);
	},
);
