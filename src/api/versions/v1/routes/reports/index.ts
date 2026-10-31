import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../db";
import { PermissionHelper } from "../../../../../utils/permission-helper";
import { APIResponse } from "../../../../utils/api-res";
import { AuditLog } from "../../../../utils/auditLog";
import { AuthHandler } from "../../../../utils/authHandler";
import { RateLimiter } from "../../../../utils/rateLimiter";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { ReportsModel } from "./model";

const reportsPerUser = new RateLimiter(10, 60 * 60 * 1000); // 10 per hour

export const router = new Hono().basePath("/reports");

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Report a package or publisher",
		description:
			"Flag a package or publisher for the moderators (malware, spam, copyright, …). Needs a signed-in account with a confirmed email address.",
		tags: [DOCS_TAGS.REPORTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Report submitted. Thank you!", ReportsModel.Create.Response),
			APIResponseSpec.unauthorized("Authentication required"),
			APIResponseSpec.forbidden("Confirm your email address before reporting"),
			APIResponseSpec.notFound("The reported package or publisher does not exist"),
			APIResponseSpec.tooManyRequests("You have sent too many reports. Try again later."),
		),
	}),

	zValidator("json", ReportsModel.Create.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		if (authContext.type === "unauthenticated") {
			return APIResponse.unauthorized(c, "Authentication required");
		}

		const reporter = await DB.instance()
			.select({ email_verified_at: DB.Tables.users.email_verified_at })
			.from(DB.Tables.users)
			.where(eq(DB.Tables.users.id, authContext.user_id))
			.get();
		if (!reporter?.email_verified_at) {
			return APIResponse.forbidden(c, "Confirm your email address before reporting");
		}

		const body = c.req.valid("json");

		let target: { id: number; label: string } | undefined;
		if (body.target_type === "package") {
			const pkg = await DB.instance()
				.select()
				.from(DB.Tables.packagesFullView)
				.where(eq(DB.Tables.packagesFullView.fullname, body.target_name))
				.get();
			if (pkg && (await PermissionHelper.canViewPackage(authContext, pkg))) {
				target = { id: pkg.id, label: pkg.fullname };
			}
		} else {
			const publisher = await DB.instance()
				.select({ id: DB.Tables.publishers.id, name: DB.Tables.publishers.name })
				.from(DB.Tables.publishers)
				.where(eq(DB.Tables.publishers.name, body.target_name))
				.get();
			if (publisher) {
				target = { id: publisher.id, label: publisher.name };
			}
		}

		if (!target) {
			return APIResponse.notFound(c, "The reported package or publisher does not exist");
		}

		if (!reportsPerUser.hit(String(authContext.user_id))) {
			return APIResponse.tooManyRequests(c, "You have sent too many reports. Try again later.");
		}

		const report = await DB.instance().transaction(async (tx) => {
			const created = await tx
				.insert(DB.Tables.reports)
				.values({
					reporter_user_id: authContext.user_id,
					target_type: body.target_type,
					target_id: target.id,
					target_label: target.label,
					reason: body.reason,
					details: body.details,
				})
				.returning()
				.get();

			await AuditLog.record(
				{
					actor: authContext,
					action: "report.create",
					targetType: "report",
					targetID: created.id,
					targetLabel: `${body.target_type} ${target.label}`,
					metadata: { reason: body.reason },
				},
				tx,
			);

			return created;
		});

		return APIResponse.created(c, "Report submitted. Thank you!", {
			id: report.id,
		} satisfies ReportsModel.Create.Response);
	},
);
