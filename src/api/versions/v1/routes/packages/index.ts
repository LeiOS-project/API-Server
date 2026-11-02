import { and, asc, desc, eq, inArray, like, not, or, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { AptlyAPI } from "../../../../../aptly/api";
import { DB } from "../../../../../db";
import { TaskScheduler } from "../../../../../tasks";
import { Utils } from "../../../../../utils";
import { PermissionHelper } from "../../../../../utils/permission-helper";
import { APIResponse } from "../../../../utils/api-res";
import { AuditLog } from "../../../../utils/auditLog";
import { AuthHandler } from "../../../../utils/authHandler";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { StablePromotion } from "../../../../utils/stablePromotion";
import { DOCS_TAGS } from "../../docs";
import { PackageModel } from "./model";

export class PackageUtils {
	/** SQL condition: the package's `flags` JSON array contains `flag`. */
	static hasFlag(flag: PackageModel.PackageFlags[number]) {
		return sql`exists (select 1 from json_each(${DB.Tables.packagesFullView.flags}) where value = ${flag})`;
	}
}

/** Per-request values loaded by the parameter middlewares (this router's or a parent's). */
type Variables = {
	package: DB.Models.PackageFullView;
};

export const router = new Hono<{ Variables: Variables }>().basePath("/packages");

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "List packages",
		description: "Retrieve a list of packages, optionally filtered by publisher or search string.",
		tags: [DOCS_TAGS.PACKAGES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Packages retrieved successfully", PackageModel.GetAll.Response),
		),
	}),

	zValidator("query", PackageModel.GetAll.Query),

	async (c) => {
		const {
			limit,
			offset,
			searchString,
			publisherID,
			publisherName,
			onlyMembershipByMe,
			sort,
			channel,
			flag,
		} = c.req.valid("query");
		const authContext = AuthHandler.AuthContext.get(c);

		const filters: Array<SQL<unknown> | undefined> = [];

		if (onlyMembershipByMe) {
			if (authContext.type === "unauthenticated") {
				return APIResponse.success(c, "Packages retrieved successfully", {
					items: [],
					total: 0,
				} satisfies PackageModel.GetAll.Response);
			}

			// A user's packages: everything published by a publisher they are a member of, plus
			// packages they hold a direct role assignment on.
			filters.push(
				or(
					inArray(
						DB.Tables.packagesFullView.publisher_id,
						DB.instance()
							.select({ id: DB.Tables.publisherMembers.publisher_id })
							.from(DB.Tables.publisherMembers)
							.where(eq(DB.Tables.publisherMembers.user_id, authContext.user_id)),
					),
					inArray(
						DB.Tables.packagesFullView.id,
						DB.instance()
							.select({ id: DB.Tables.roleAssignments.package_id })
							.from(DB.Tables.roleAssignments)
							.where(eq(DB.Tables.roleAssignments.user_id, authContext.user_id)),
					),
				),
			);
		}

		if (publisherID !== undefined) {
			filters.push(eq(DB.Tables.packagesFullView.publisher_id, publisherID));
		} else if (publisherName !== undefined) {
			const publisher = await DB.instance()
				.select({ id: DB.Tables.publishers.id })
				.from(DB.Tables.publishers)
				.where(eq(DB.Tables.publishers.name, publisherName))
				.get();
			if (!publisher) {
				return APIResponse.success(c, "Packages retrieved successfully", {
					items: [],
					total: 0,
				} satisfies PackageModel.GetAll.Response);
			}
			filters.push(eq(DB.Tables.packagesFullView.publisher_id, publisher.id));
		}

		if (searchString) {
			filters.push(
				or(
					like(DB.Tables.packagesFullView.name, `%${searchString}%`),
					like(DB.Tables.packagesFullView.display_name, `%${searchString}%`),
					like(DB.Tables.packagesFullView.fullname, `%${searchString}%`),
				),
			);
		}

		// Hidden packages only show up in a member's own list and for site staff.
		const seesHidden = onlyMembershipByMe || PermissionHelper.isSiteStaff(authContext);
		if (!seesHidden) {
			filters.push(not(PackageUtils.hasFlag("HIDDEN")));
		}

		if (flag) {
			filters.push(PackageUtils.hasFlag(flag));
		}

		if (channel) {
			const column =
				channel === "stable"
					? DB.Tables.packagesFullView.latest_stable_release
					: DB.Tables.packagesFullView.latest_testing_release;
			filters.push(
				sql`(json_extract(${column}, '$.amd64') is not null or json_extract(${column}, '$.arm64') is not null)`,
			);
		}

		const where = filters.length > 0 ? and(...filters) : undefined;

		const orderBy = {
			name: [asc(DB.Tables.packagesFullView.fullname)],
			newest: [desc(DB.Tables.packagesFullView.created_at), asc(DB.Tables.packagesFullView.fullname)],
			updated: [
				sql`${DB.Tables.packagesFullView.last_release_at} is null`,
				desc(DB.Tables.packagesFullView.last_release_at),
				asc(DB.Tables.packagesFullView.fullname),
			],
		}[sort];

		const items = await DB.instance()
			.select()
			.from(DB.Tables.packagesFullView)
			.where(where)
			.orderBy(...orderBy)
			.limit(limit)
			.offset(offset);

		const total = await DB.instance().$count(DB.Tables.packagesFullView, where);

		return APIResponse.success(c, "Packages retrieved successfully", {
			items,
			total,
		} satisfies PackageModel.GetAll.Response);
	},
);

// Create a new package
router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create a new package",
		description:
			"Create a new package under the given publisher. Requires packages.create permission on that publisher.",
		tags: [DOCS_TAGS.PACKAGES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.createdNoData("Package created successfully"),
			APIResponseSpec.conflict("Package with this name already exists in this publisher"),
			APIResponseSpec.forbidden("You do not have permission to create packages in this publisher"),
			APIResponseSpec.notFound("Publisher not found"),
		),
	}),

	zValidator("json", PackageModel.CreatePackage.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		const body = c.req.valid("json");

		if (authContext.type === "unauthenticated") {
			return APIResponse.unauthorized(c, "Authentication required");
		}

		const publisher = await DB.instance()
			.select({ id: DB.Tables.publishers.id, name: DB.Tables.publishers.name })
			.from(DB.Tables.publishers)
			.where(eq(DB.Tables.publishers.id, body.publisher_id))
			.get();

		if (!publisher) {
			return APIResponse.notFound(c, "Publisher not found");
		}

		const allowed = await PermissionHelper.can({
			authContext,
			publisherId: publisher.id,
			check: (p) => p.packages.create,
		});

		if (!allowed) {
			return APIResponse.forbidden(
				c,
				"You do not have permission to create packages in this publisher",
			);
		}

		const existingPackage = await DB.instance()
			.select({ id: DB.Tables.packages.id })
			.from(DB.Tables.packages)
			.where(
				and(eq(DB.Tables.packages.publisher_id, publisher.id), eq(DB.Tables.packages.name, body.name)),
			)
			.get();

		if (existingPackage) {
			return APIResponse.conflict(c, "Package with this name already exists in this publisher");
		}

		const result = await DB.instance()
			.insert(DB.Tables.packages)
			.values({
				publisher_id: publisher.id,
				name: body.name,
				display_name: body.display_name,
				description: body.description,
				homepage_url: body.homepage_url,
				requires_patching: body.requires_patching,
			})
			.returning()
			.get();

		await AuditLog.record({
			actor: authContext,
			action: "package.create",
			targetType: "package",
			targetID: result.id,
			targetLabel: `${publisher.name}.${body.name}`,
		});

		return APIResponse.created(c, "Package created successfully", { id: result.id });
	},
);

// Loads the package (and its publisher) by :publisherName/:packageName for sub-routes.
router.use(
	"/:fullPackageName/*",

	zValidator("param", PackageModel.Param),

	async (c, next) => {
		// @ts-expect-error - hono-openapi's validator does not type "param" yet
		const { fullPackageName } = c.req.valid("param") as { fullPackageName: string };

		const row = await DB.instance()
			.select()
			.from(DB.Tables.packagesFullView)
			.where(eq(DB.Tables.packagesFullView.fullname, fullPackageName))
			.get();

		if (!row || !(await PermissionHelper.canViewPackage(AuthHandler.AuthContext.get(c), row))) {
			return APIResponse.notFound(c, "Package with specified name not found");
		}

		c.set("package", row satisfies DB.Models.PackageFullView);

		return await next();
	},
);

router.get(
	"/:fullPackageName",

	APIRouteSpec.unauthenticated({
		summary: "Get package details",
		description: "Retrieve details of a specific package.",
		tags: [DOCS_TAGS.PACKAGES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Package retrieved successfully",
				PackageModel.GetPackageByFullName.Response,
			),
			APIResponseSpec.notFound("Package with specified name not found"),
		),
	}),

	async (c) => {
		const pkg = c.get("package");

		return APIResponse.success(
			c,
			"Package retrieved successfully",
			Utils.asExact<PackageModel.GetPackageByFullName.Response>()(pkg),
		);
	},
);

router.put(
	"/:fullPackageName",

	APIRouteSpec.authenticated({
		summary: "Update package details",
		description: "Update details of a specific package. Requires packages.update permission.",
		tags: [DOCS_TAGS.PACKAGES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Package updated successfully"),
			APIResponseSpec.notFound("Package with specified name not found"),
			APIResponseSpec.forbidden(
				"System-managed packages cannot be updated / You do not have permission to update this package",
			),
		),
	}),

	zValidator("json", PackageModel.UpdatePackage.Body),

	async (c) => {
		const pkg = c.get("package");
		const authContext = AuthHandler.AuthContext.get(c);
		const updateData = c.req.valid("json");

		if (pkg.flags.includes("SYSTEM-MANAGED")) {
			return APIResponse.forbidden(c, "System-managed packages cannot be updated");
		}

		const allowed = await PermissionHelper.can({
			authContext,
			publisherId: pkg.publisher_id,
			packageId: pkg.id,
			check: (p) => p.packages.update,
		});

		if (!allowed) {
			return APIResponse.forbidden(c, "You do not have permission to update this package");
		}

		await DB.instance()
			.update(DB.Tables.packages)
			.set(updateData)
			.where(eq(DB.Tables.packages.id, pkg.id));

		await AuditLog.record({
			actor: authContext,
			action: "package.update",
			targetType: "package",
			targetID: pkg.id,
			targetLabel: pkg.fullname,
			metadata: { fields: Object.keys(updateData) },
		});

		return APIResponse.successNoData(c, "Package updated successfully");
	},
);

router.delete(
	"/:fullPackageName",

	APIRouteSpec.authenticated({
		summary: "Delete a package",
		description: "Delete a specific package and its releases. Requires packages.delete permission.",
		tags: [DOCS_TAGS.PACKAGES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Package deleted successfully"),
			APIResponseSpec.notFound("Package with specified name not found"),
			APIResponseSpec.forbidden(
				"System-managed packages cannot be deleted / You do not have permission to delete this package",
			),
			APIResponseSpec.conflict("A release of this package is being published with an OS release"),
			APIResponseSpec.serverError("Failed to delete package from Aptly repositories"),
		),
	}),

	async (c) => {
		const pkg = c.get("package");
		const authContext = AuthHandler.AuthContext.get(c);

		if (pkg.flags.includes("SYSTEM-MANAGED")) {
			return APIResponse.forbidden(c, "System-managed packages cannot be deleted");
		}

		const allowed = await PermissionHelper.can({
			authContext,
			publisherId: pkg.publisher_id,
			packageId: pkg.id,
			check: (p) => p.packages.delete,
		});

		if (!allowed) {
			return APIResponse.forbidden(c, "You do not have permission to delete this package");
		}

		const packageReleaseIDs = await DB.instance()
			.select({
				id: DB.Tables.packageReleases.id,
			})
			.from(DB.Tables.packageReleases)
			.where(eq(DB.Tables.packageReleases.package_id, pkg.id));

		const publishing = await StablePromotion.getPublishingOSRelease(
			packageReleaseIDs.map((release) => release.id),
		);
		if (publishing) {
			return APIResponse.conflict(
				c,
				`A release of this package is being published with LeiOS ${publishing.version}; delete it once that finished`,
			);
		}

		let aptlyDeleted: boolean;

		try {
			aptlyDeleted = await AptlyAPI.Packages.deleteAllInAllRepos(pkg.fullname);
		} catch {
			return APIResponse.serverError(c, "Failed to delete package from Aptly repositories");
		}

		if (!aptlyDeleted) {
			return APIResponse.serverError(c, "Failed to delete package from Aptly repositories");
		}

		await DB.instance().transaction(async (tx) => {
			// Queued requests leave the stable queue with the package.
			await StablePromotion.deleteRequests({ packageID: pkg.id }, tx);

			await tx
				.delete(DB.Tables.packageReleases)
				.where(eq(DB.Tables.packageReleases.package_id, pkg.id));

			await tx.delete(DB.Tables.packages).where(eq(DB.Tables.packages.id, pkg.id));
		});

		await TaskScheduler.enqueueTask("testing-repo:update", {}, { created_by_user_id: null });

		await AuditLog.record({
			actor: authContext,
			action: "package.delete",
			targetType: "package",
			targetID: pkg.id,
			targetLabel: pkg.fullname,
		});

		return APIResponse.successNoData(c, "Package deleted successfully");
	},
);

router.route("/:fullPackageName", (await import("./releases")).router);
router.route("/:fullPackageName", (await import("./role-assignments")).router);
