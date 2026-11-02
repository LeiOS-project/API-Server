import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { AptlyAPI } from "../../../../../../aptly/api";
import { DB } from "../../../../../../db";
import { TaskScheduler } from "../../../../../../tasks";
import { Logger } from "../../../../../../utils/logger";
import { PermissionHelper } from "../../../../../../utils/permission-helper";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { StablePromotion } from "../../../../../utils/stablePromotion";
import { DOCS_TAGS } from "../../../docs";
import { PackageReleaseModel } from "./model";

/** Per-request values loaded by the parameter middlewares (this router's or a parent's). */
type Variables = {
	package: DB.Models.PackageFullView;
	release: DB.Models.PackageRelease;
};

export const router = new Hono<{ Variables: Variables }>().basePath("/releases");

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "List all package releases",
		description: "Retrieve a list of all releases for the specified package.",
		tags: [DOCS_TAGS.PACKAGES_RELEASES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Package releases retrieved successfully",
				PackageReleaseModel.GetAll.Response,
			),
		),
	}),

	async (c) => {
		const pkg = c.get("package");

		const releases = await DB.instance()
			.select()
			.from(DB.Tables.packageReleases)
			.where(eq(DB.Tables.packageReleases.package_id, pkg.id));

		return APIResponse.success(
			c,
			"Package releases retrieved successfully",
			(await StablePromotion.withStablePromotion(
				releases,
			)) satisfies PackageReleaseModel.GetAll.Response,
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create a new package release",
		description:
			"Create a new release for the specified package. Requires packages.releases.publish permission.",
		tags: [DOCS_TAGS.PACKAGES_RELEASES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.createdNoData("Package release created successfully"),
			APIResponseSpec.conflict("Package release with this version already exists"),
			APIResponseSpec.forbidden("You do not have permission to publish releases for this package"),
			APIResponseSpec.badRequest(
				"Package requires leios patch suffix in version but is missing in version argument",
			),
		),
	}),

	zValidator("json", PackageReleaseModel.CreateRelease.Body),

	async (c) => {
		const pkg = c.get("package");
		const authContext = AuthHandler.AuthContext.get(c);
		const body = c.req.valid("json");

		const allowed = await PermissionHelper.can({
			authContext,
			publisherId: pkg.publisher_id,
			packageId: pkg.id,
			check: (p) => p.packages.releases.publish,
		});

		if (!allowed) {
			return APIResponse.forbidden(
				c,
				"You do not have permission to publish releases for this package",
			);
		}

		if (pkg.requires_patching) {
			const matches = body.version_with_leios_patch.match(
				PackageReleaseModel.versionWithRequiredLeiOSPatchRegex,
			);
			if (!matches) {
				return APIResponse.badRequest(
					c,
					"Package requires leios patch suffix in version but is missing in version argument",
				);
			}
		}

		const existingRelease = await DB.instance()
			.select({ id: DB.Tables.packageReleases.id })
			.from(DB.Tables.packageReleases)
			.where(
				and(
					eq(DB.Tables.packageReleases.package_id, pkg.id),
					eq(DB.Tables.packageReleases.version_with_leios_patch, body.version_with_leios_patch),
				),
			)
			.get();

		if (existingRelease) {
			return APIResponse.conflict(c, "Package release with this version already exists");
		}

		await DB.instance().insert(DB.Tables.packageReleases).values({
			package_id: pkg.id,
			version_with_leios_patch: body.version_with_leios_patch,
			changelog: body.changelog,
		});

		await AuditLog.record({
			actor: authContext,
			action: "release.create",
			targetType: "release",
			targetLabel: `${pkg.fullname} ${body.version_with_leios_patch}`,
		});

		return APIResponse.createdNoData(c, "Package release created successfully");
	},
);

router.use(
	"/:version_with_leios_patch/*",

	zValidator("param", PackageReleaseModel.Param),

	async (c, next) => {
		// @ts-expect-error - hono-openapi's validator does not type "param" yet
		const { version_with_leios_patch } = c.req.valid("param") as { version_with_leios_patch: string };
		const pkg = c.get("package");

		const releaseData = await DB.instance()
			.select()
			.from(DB.Tables.packageReleases)
			.where(
				and(
					eq(DB.Tables.packageReleases.package_id, pkg.id),
					eq(DB.Tables.packageReleases.version_with_leios_patch, version_with_leios_patch),
				),
			)
			.get();

		if (!releaseData) {
			return APIResponse.notFound(c, "Package release with specified version not found");
		}

		c.set("release", releaseData);

		return await next();
	},
);

router.route("/:version_with_leios_patch", (await import("./stable-promotion-requests")).router);

router.get(
	"/:version_with_leios_patch",

	APIRouteSpec.unauthenticated({
		summary: "Get package release details",
		description: "Retrieve details of a specific package release.",
		tags: [DOCS_TAGS.PACKAGES_RELEASES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Package release retrieved successfully",
				PackageReleaseModel.GetReleaseByVersion.Response,
			),
			APIResponseSpec.notFound("Package release with specified version not found"),
		),
	}),

	async (c) => {
		const [release] = await StablePromotion.withStablePromotion([c.get("release")]);
		return APIResponse.success(
			c,
			"Package release retrieved successfully",
			release! satisfies PackageReleaseModel.GetReleaseByVersion.Response,
		);
	},
);

router.put(
	"/:version_with_leios_patch",

	APIRouteSpec.authenticated({
		summary: "Update a package release",
		description:
			"Update details of a specific package release. Requires packages.releases.update permission.",
		tags: [DOCS_TAGS.PACKAGES_RELEASES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Package release updated successfully"),
			APIResponseSpec.notFound("Package release with specified version not found"),
			APIResponseSpec.forbidden("You do not have permission to update releases for this package"),
		),
	}),

	zValidator("json", PackageReleaseModel.UpdateRelease.Body),

	async (c) => {
		const pkg = c.get("package");
		const release = c.get("release");
		const authContext = AuthHandler.AuthContext.get(c);
		const body = c.req.valid("json");

		const allowed = await PermissionHelper.can({
			authContext,
			publisherId: pkg.publisher_id,
			packageId: pkg.id,
			check: (p) => p.packages.releases.update,
		});

		if (!allowed) {
			return APIResponse.forbidden(
				c,
				"You do not have permission to update releases for this package",
			);
		}

		await DB.instance()
			.update(DB.Tables.packageReleases)
			.set(body)
			.where(eq(DB.Tables.packageReleases.id, release.id));

		await AuditLog.record({
			actor: authContext,
			action: "release.update",
			targetType: "release",
			targetID: release.id,
			targetLabel: `${pkg.fullname} ${release.version_with_leios_patch}`,
		});

		return APIResponse.successNoData(c, "Package release updated successfully");
	},
);

router.post(
	"/:version_with_leios_patch/:arch",

	APIRouteSpec.authenticated({
		summary: "Upload package release file for architecture and release into testing repository",
		description: "Upload a release file for the specified package and architecture.",
		tags: [DOCS_TAGS.PACKAGES_RELEASES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.createdNoData("Package release file uploaded successfully"),
			APIResponseSpec.conflict("Package release already contains a release for this architecture"),
			APIResponseSpec.forbidden("You do not have permission to publish releases for this package"),
			APIResponseSpec.serverError("Failed to upload and verify package release asset"),
		),
	}),

	zValidator("form", PackageReleaseModel.UploadReleaseAssetForArch.FileInput),

	zValidator("param", PackageReleaseModel.PostParamWithArch),

	async (c) => {
		const pkg = c.get("package");
		const release = c.get("release");
		const authContext = AuthHandler.AuthContext.get(c);
		const { file } = c.req.valid("form");
		const { arch } = c.req.valid("param");

		const allowed = await PermissionHelper.can({
			authContext,
			publisherId: pkg.publisher_id,
			packageId: pkg.id,
			check: (p) => p.packages.releases.publish,
		});

		if (!allowed) {
			return APIResponse.forbidden(
				c,
				"You do not have permission to publish releases for this package",
			);
		}

		// Look up publisher to get maintainer contact info for Aptly upload
		const publisher = await DB.instance()
			.select()
			.from(DB.Tables.publishers)
			.where(eq(DB.Tables.publishers.id, pkg.publisher_id))
			.get();
		if (!publisher) {
			return APIResponse.serverError(c, "Publisher not found for this package");
		}

		const existingArchForRelease =
			arch === "all" ? release.architectures.is_all : release.architectures[arch];

		if (existingArchForRelease) {
			return APIResponse.conflict(
				c,
				"Package release already contains a release for this architecture",
			);
		}

		try {
			const result = await AptlyAPI.Packages.uploadAndVerifyIntoArchiveRepo(
				{
					fullname: pkg.fullname,
					versionWithLeiosPatch: release.version_with_leios_patch,
					architecture: arch,
					maintainer_name: publisher.maintainer_contact_name,
					maintainer_email: publisher.maintainer_contact_email,
				},
				file,
			);

			if (!result) {
				return APIResponse.serverError(c, "Failed to upload and verify package release asset");
			}

			let cleanupResult: boolean;

			if (arch === "all") {
				cleanupResult = await AptlyAPI.Packages.deleteInRepo("leios-testing", pkg.fullname, undefined);
			} else {
				cleanupResult = await AptlyAPI.Packages.deleteInRepo(
					"leios-testing",
					pkg.fullname,
					undefined,
					arch,
				);
			}
			if (!cleanupResult) {
				return APIResponse.serverError(
					c,
					"Failed to clean up existing package releases in testing repository",
				);
			}

			const copyResult = await AptlyAPI.Packages.copyIntoRepo(
				"leios-testing",
				pkg.fullname,
				release.version_with_leios_patch,
				arch,
			);
			if (!copyResult) {
				return APIResponse.serverError(c, "Failed to copy package release into testing repository");
			}

			await TaskScheduler.enqueueTask("testing-repo:update", {}, { created_by_user_id: null });

			if (arch === "all") {
				release.architectures = {
					amd64: true,
					arm64: true,
					is_all: true,
				};
			} else {
				release.architectures[arch] = true;
			}

			await DB.instance()
				.update(DB.Tables.packageReleases)
				.set({
					architectures: release.architectures,
				})
				.where(eq(DB.Tables.packageReleases.id, release.id));

			if (arch === "all") {
				pkg.latest_testing_release = {
					amd64: release.version_with_leios_patch,
					arm64: release.version_with_leios_patch,
				};
			} else if (arch === "amd64") {
				pkg.latest_testing_release.amd64 = release.version_with_leios_patch;
			} else if (arch === "arm64") {
				pkg.latest_testing_release.arm64 = release.version_with_leios_patch;
			} else {
				throw new Error("Unrecognized architecture: " + arch);
			}

			await DB.instance()
				.update(DB.Tables.packages)
				.set({
					latest_testing_release: pkg.latest_testing_release,
				})
				.where(eq(DB.Tables.packages.id, pkg.id));
		} catch (error) {
			Logger.error("Failed to upload and verify package release:", error);
			return APIResponse.serverError(c, "Failed to upload and verify package release");
		}

		await AuditLog.record({
			actor: authContext,
			action: "release.upload",
			targetType: "release",
			targetID: release.id,
			targetLabel: `${pkg.fullname} ${release.version_with_leios_patch}`,
			metadata: { arch },
		});

		return APIResponse.createdNoData(c, "Package release file uploaded successfully");
	},
);

router.delete(
	"/:version_with_leios_patch",

	APIRouteSpec.authenticated({
		summary: "Delete a package release",
		description: "Delete a specific package release. Requires packages.releases.delete permission.",
		tags: [DOCS_TAGS.PACKAGES_RELEASES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Package release deleted successfully"),
			APIResponseSpec.notFound("Package release with specified version not found"),
			APIResponseSpec.forbidden("You do not have permission to delete releases for this package"),
			APIResponseSpec.conflict("The release is being published with an OS release"),
			APIResponseSpec.serverError("Failed to delete release from Aptly repositories"),
		),
	}),

	async (c) => {
		const pkg = c.get("package");
		const release = c.get("release");
		const authContext = AuthHandler.AuthContext.get(c);

		const allowed = await PermissionHelper.can({
			authContext,
			publisherId: pkg.publisher_id,
			packageId: pkg.id,
			check: (p) => p.packages.releases.delete,
		});

		if (!allowed) {
			return APIResponse.forbidden(
				c,
				"You do not have permission to delete releases for this package",
			);
		}

		const publishing = await StablePromotion.getPublishingOSRelease([release.id]);
		if (publishing) {
			return APIResponse.conflict(
				c,
				`The release is being published with LeiOS ${publishing.version}; delete it once that finished`,
			);
		}

		let aptlyDeleted: boolean;

		try {
			aptlyDeleted = await AptlyAPI.Packages.deleteAllInAllRepos(
				pkg.fullname,
				release.version_with_leios_patch,
				undefined,
			);
		} catch {
			return APIResponse.serverError(c, "Failed to delete release from Aptly repositories");
		}

		if (!aptlyDeleted) {
			return APIResponse.serverError(c, "Failed to delete release from Aptly repositories");
		}

		// Testing and stable hold one version per architecture, so a deleted release that was the
		// latest one there leaves that architecture empty.
		const withoutDeletedVersion = (latest: DB.Models.Package["latest_testing_release"]) => ({
			amd64: latest.amd64 === release.version_with_leios_patch ? null : latest.amd64,
			arm64: latest.arm64 === release.version_with_leios_patch ? null : latest.arm64,
		});

		await DB.instance().transaction(async (tx) => {
			// A queued request leaves the stable queue with its release.
			await StablePromotion.deleteRequests({ packageReleaseID: release.id }, tx);

			await tx.delete(DB.Tables.packageReleases).where(eq(DB.Tables.packageReleases.id, release.id));

			await tx
				.update(DB.Tables.packages)
				.set({
					latest_testing_release: withoutDeletedVersion(pkg.latest_testing_release),
					latest_stable_release: withoutDeletedVersion(pkg.latest_stable_release),
				})
				.where(eq(DB.Tables.packages.id, pkg.id));
		});

		await TaskScheduler.enqueueTask("testing-repo:update", {}, { created_by_user_id: null });

		await AuditLog.record({
			actor: authContext,
			action: "release.delete",
			targetType: "release",
			targetID: release.id,
			targetLabel: `${pkg.fullname} ${release.version_with_leios_patch}`,
		});

		return APIResponse.successNoData(c, "Package release deleted successfully");
	},
);
