import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import type { PackageModel } from "../../packages/model";
import { AdminPackagesModel } from "./model";

export const router = new Hono().basePath("/packages");

router.put(
	"/:fullPackageName/moderation",

	APIRouteSpec.authenticated({
		summary: "Set package moderation flags",
		description:
			"Hide a package from the public hub or mark it as deprecated, with a note. Hidden packages stay visible to their publisher's members and to admins.",
		tags: [DOCS_TAGS.ADMIN_PACKAGES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Package moderation updated"),
			APIResponseSpec.notFound("Package not found"),
			APIResponseSpec.forbidden("System-managed packages cannot be moderated"),
		),
	}),

	zValidator("param", AdminPackagesModel.Param),
	zValidator("json", AdminPackagesModel.UpdateModeration.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		const { fullPackageName } = c.req.valid("param");
		const { hidden, deprecated, note } = c.req.valid("json");

		const pkg = await DB.instance()
			.select()
			.from(DB.Tables.packagesFullView)
			.where(eq(DB.Tables.packagesFullView.fullname, fullPackageName))
			.get();

		if (!pkg) {
			return APIResponse.notFound(c, "Package not found");
		}

		if (pkg.flags.includes("SYSTEM-MANAGED")) {
			return APIResponse.forbidden(c, "System-managed packages cannot be moderated");
		}

		const flags: PackageModel.PackageFlags = pkg.flags.filter(
			(flag) => flag !== "HIDDEN" && flag !== "DEPRECATED",
		);
		if (hidden) flags.push("HIDDEN");
		if (deprecated) flags.push("DEPRECATED");

		await DB.instance().transaction(async (tx) => {
			await tx
				.update(DB.Tables.packages)
				.set({ flags, moderation_note: hidden || deprecated ? note : null })
				.where(eq(DB.Tables.packages.id, pkg.id))
				.run();

			await AuditLog.record(
				{
					actor: authContext,
					action: "package.moderation_update",
					targetType: "package",
					targetID: pkg.id,
					targetLabel: pkg.fullname,
					metadata: { hidden, deprecated, note },
				},
				tx,
			);
		});

		return APIResponse.successNoData(c, "Package moderation updated");
	},
);
