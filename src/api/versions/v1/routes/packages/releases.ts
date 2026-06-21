import { Hono } from "hono";
import { PackageReleaseModel } from '../../../../utils/shared-models/pkg-releases';
import { validator as zValidator } from "hono-openapi";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DB } from "../../../../../db";
import { and, eq } from "drizzle-orm";
import { APIResponse } from "../../../../utils/api-res";
import { AuthHandler } from "../../../../utils/authHandler";
import { PermissionHelper } from "../../../../../utils/permission-helper";
import { AptlyAPI } from "../../../../../aptly/api";
import { TaskScheduler } from "../../../../../tasks";
import { RuntimeMetadata } from "../../../../utils/metadata";
import { Logger } from "../../../../../utils/logger";
import { DOCS_TAGS } from "../../docs";

export const router = new Hono().basePath('/releases');

router.get('/',

    APIRouteSpec.unauthenticated({
        summary: "List all package releases",
        description: "Retrieve a list of all releases for the specified package.",
        tags: [DOCS_TAGS.PACKAGES_RELEASES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Package releases retrieved successfully", PackageReleaseModel.GetAll.Response)
        )
    }),

    async (c) => {
        // @ts-ignore
        const pkg = c.get("package") as DB.Models.PackageFullView;

        const releases = await DB.instance().select().from(DB.Tables.packageReleases).where(
            eq(DB.Tables.packageReleases.package_id, pkg.id)
        );

        return APIResponse.success(c, "Package releases retrieved successfully", releases satisfies PackageReleaseModel.GetAll.Response);
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create a new package release",
        description: "Create a new release for the specified package. Requires packages.releases.publish permission.",
        tags: [DOCS_TAGS.PACKAGES_RELEASES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.createdNoData("Package release created successfully"),
            APIResponseSpec.conflict("Package release with this version already exists"),
            APIResponseSpec.forbidden("You do not have permission to publish releases for this package"),
            APIResponseSpec.badRequest("Package requires leios patch suffix in version but is missing in version argument")
        )
    }),

    zValidator("json", PackageReleaseModel.CreateRelease.Body),

    async (c) => {
        // @ts-ignore
        const pkg = c.get("package") as DB.Models.PackageFullView;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        const body = c.req.valid("json");

        if (pkg.flags.includes("SYSTEM-MANAGED")) {
            return APIResponse.forbidden(c, "System-managed packages cannot have new releases created");
        }

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: pkg.publisher_id,
            packageId: pkg.id,
            check: (p) => p.packages.releases.publish
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to publish releases for this package");
        }

        if (pkg.requires_patching) {
            const matches = body.version_with_leios_patch.match(PackageReleaseModel.versionWithRequiredLeiOSPatchRegex);
            if (!matches) {
                return APIResponse.badRequest(c, "Package requires leios patch suffix in version but is missing in version argument");
            }
        }

        const existingRelease = await DB.instance().select({ id: DB.Tables.packageReleases.id }).from(DB.Tables.packageReleases).where(
            and(
                eq(DB.Tables.packageReleases.package_id, pkg.id),
                eq(DB.Tables.packageReleases.version_with_leios_patch, body.version_with_leios_patch),
            )
        ).get();

        if (existingRelease) {
            return APIResponse.conflict(c, "Package release with this version already exists");
        }

        await DB.instance().insert(DB.Tables.packageReleases).values({
            package_id: pkg.id,
            version_with_leios_patch: body.version_with_leios_patch,
            changelog: body.changelog
        });

        return APIResponse.createdNoData(c, "Package release created successfully");
    }
);


router.use('/:version_with_leios_patch/*',

    zValidator("param", PackageReleaseModel.Param),

    async (c, next) => {
        // @ts-ignore
        const { version_with_leios_patch } = c.req.valid("param") as { version_with_leios_patch: string };
        // @ts-ignore
        const pkg = c.get("package") as DB.Models.PackageFullView;

        const releaseData = await DB.instance().select().from(DB.Tables.packageReleases).where(and(
            eq(DB.Tables.packageReleases.package_id, pkg.id),
            eq(DB.Tables.packageReleases.version_with_leios_patch, version_with_leios_patch)
        )).get();

        if (!releaseData) {
            return APIResponse.notFound(c, "Package release with specified version not found");
        }

        // @ts-ignore
        c.set("release", releaseData);

        return await next();
    }
);


router.get('/:version_with_leios_patch',

    APIRouteSpec.unauthenticated({
        summary: "Get package release details",
        description: "Retrieve details of a specific package release.",
        tags: [DOCS_TAGS.PACKAGES_RELEASES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Package release retrieved successfully", PackageReleaseModel.GetReleaseByVersion.Response),
            APIResponseSpec.notFound("Package release with specified version not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const release = c.get("release") as DB.Models.PackageRelease;
        return APIResponse.success(c, "Package release retrieved successfully", release satisfies PackageReleaseModel.GetReleaseByVersion.Response);
    }
);

router.put('/:version_with_leios_patch',

    APIRouteSpec.authenticated({
        summary: "Update a package release",
        description: "Update details of a specific package release. Requires packages.releases.update permission.",
        tags: [DOCS_TAGS.PACKAGES_RELEASES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Package release updated successfully"),
            APIResponseSpec.notFound("Package release with specified version not found"),
            APIResponseSpec.forbidden("You do not have permission to update releases for this package")
        )
    }),

    zValidator("json", PackageReleaseModel.UpdateRelease.Body),

    async (c) => {
        // @ts-ignore
        const pkg = c.get("package") as DB.Models.PackageFullView;
        // @ts-ignore
        const release = c.get("release") as DB.Models.PackageRelease;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        const body = c.req.valid("json");

        if (pkg.flags.includes("SYSTEM-MANAGED")) {
            return APIResponse.forbidden(c, "System-managed packages cannot have their releases updated");
        }

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: pkg.publisher_id,
            packageId: pkg.id,
            check: (p) => p.packages.releases.update
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to update releases for this package");
        }

        await DB.instance().update(DB.Tables.packageReleases).set(body).where(
            eq(DB.Tables.packageReleases.id, release.id)
        );

        return APIResponse.successNoData(c, "Package release updated successfully");
    }
);

router.post('/:version_with_leios_patch/:arch',

    APIRouteSpec.authenticated({
        summary: "Upload package release file for architecture and release into testing repository",
        description: "Upload a release file for the specified package and architecture.",
        tags: [DOCS_TAGS.PACKAGES_RELEASES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.createdNoData("Package release file uploaded successfully"),
            APIResponseSpec.conflict("Package release already contains a release for this architecture"),
            APIResponseSpec.forbidden("You do not have permission to publish releases for this package"),
            APIResponseSpec.serverError("Failed to upload and verify package release asset")
        )
    }),

    zValidator("form", PackageReleaseModel.UploadReleaseAssetForArch.FileInput),

    zValidator("param", PackageReleaseModel.PostParamWithArch),

    async (c) => {
        // @ts-ignore
        const pkg = c.get("package") as DB.Models.PackageFullView;
        // @ts-ignore
        const release = c.get("release") as DB.Models.PackageRelease;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        const { file } = c.req.valid("form");
        const { arch } = c.req.valid("param");

        if (pkg.flags.includes("SYSTEM-MANAGED")) {
            return APIResponse.forbidden(c, "System-managed packages cannot have their releases updated");
        }

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: pkg.publisher_id,
            packageId: pkg.id,
            check: (p) => p.packages.releases.publish
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to publish releases for this package");
        }

        // Look up publisher owner to act as maintainer (the schema doesn't track created_by_user_id per package anymore).
        const publisher = await DB.instance().select().from(DB.Tables.publishers).where(
            eq(DB.Tables.publishers.id, pkg.publisher_id)
        ).get();
        if (!publisher) {
            return APIResponse.serverError(c, "Publisher not found for this package");
        }
        const maintainer = await DB.instance().select().from(DB.Tables.users).where(
            eq(DB.Tables.users.id, publisher.owner_user_id)
        ).get();
        if (!maintainer) {
            return APIResponse.serverError(c, "Publisher owner not found in database");
        }

        const existingArchForRelease = arch === "all" ? release.architectures.is_all : release.architectures[arch];

        if (existingArchForRelease) {
            return APIResponse.conflict(c, "Package release already contains a release for this architecture");
        }

        const isSiteAdmin = authContext.type !== 'unauthenticated' && authContext.user_role === 'admin';

        try {
            const result = await AptlyAPI.Packages.uploadAndVerifyIntoArchiveRepo({
                    name: pkg.name,
                    versionWithLeiosPatch: release.version_with_leios_patch,
                    architecture: arch,
                    maintainer_name: maintainer.display_name,
                    maintainer_email: maintainer.email
                },
                file,
                isSiteAdmin
            );

            if (!result) {
                return APIResponse.serverError(c, "Failed to upload and verify package release asset");
            }

            let cleanupResult: boolean;

            if (arch === "all") {
                cleanupResult = await AptlyAPI.Packages.deleteInRepo("leios-testing", pkg.name, undefined);
            } else {
                cleanupResult = await AptlyAPI.Packages.deleteInRepo("leios-testing", pkg.name, undefined, arch);
            }
            if (!cleanupResult) {
                return APIResponse.serverError(c, "Failed to clean up existing package releases in testing repository");
            }

            const copyResult = await AptlyAPI.Packages.copyIntoRepo("leios-testing", pkg.name, release.version_with_leios_patch, arch);
            if (!copyResult) {
                return APIResponse.serverError(c, "Failed to copy package release into testing repository");
            }

            await TaskScheduler.enqueueTask("testing-repo:update", {}, { created_by_user_id: null });

            if (arch === "all") {
                release.architectures = {
                    amd64: true,
                    arm64: true,
                    is_all: true
                };
            } else {
                release.architectures[arch] = true;
            }

            await DB.instance().update(DB.Tables.packageReleases).set({
                architectures: release.architectures
            }).where(eq(DB.Tables.packageReleases.id, release.id));

            if (arch === "all") {
                pkg.latest_testing_release = {
                    amd64: release.version_with_leios_patch,
                    arm64: release.version_with_leios_patch
                };
            } else if (arch === "amd64") {
                pkg.latest_testing_release.amd64 = release.version_with_leios_patch;
            } else if (arch === "arm64") {
                pkg.latest_testing_release.arm64 = release.version_with_leios_patch;
            } else {
                throw new Error("Unrecognized architecture: " + arch);
            }

            await DB.instance().update(DB.Tables.packages).set({
                latest_testing_release: pkg.latest_testing_release
            }).where(eq(DB.Tables.packages.id, pkg.id));

        } catch (error) {
            Logger.error("Failed to upload and verify package release:", error);
            return APIResponse.serverError(c, "Failed to upload and verify package release");
        }

        return APIResponse.createdNoData(c, "Package release file uploaded successfully");
    }
);

router.delete('/:version_with_leios_patch',

    APIRouteSpec.authenticated({
        summary: "Delete a package release",
        description: "Delete a specific package release. Requires packages.releases.delete permission.",
        tags: [DOCS_TAGS.PACKAGES_RELEASES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Package release deleted successfully"),
            APIResponseSpec.notFound("Package release with specified version not found"),
            APIResponseSpec.forbidden("You do not have permission to delete releases for this package"),
            APIResponseSpec.serverError("Failed to delete release from Aptly repositories")
        )
    }),

    async (c) => {
        // @ts-ignore
        const pkg = c.get("package") as DB.Models.PackageFullView;
        // @ts-ignore
        const release = c.get("release") as DB.Models.PackageRelease;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        if (pkg.flags.includes("SYSTEM-MANAGED")) {
            return APIResponse.forbidden(c, "System-managed packages cannot have their releases deleted");
        }

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: pkg.publisher_id,
            packageId: pkg.id,
            check: (p) => p.packages.releases.delete
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to delete releases for this package");
        }

        let aptlyDeleted: boolean;

        try {
            aptlyDeleted = await AptlyAPI.Packages.deleteAllInAllRepos(pkg.name, release.version_with_leios_patch, undefined);
        } catch {
            return APIResponse.serverError(c, "Failed to delete release from Aptly repositories");
        }

        if (!aptlyDeleted) {
            return APIResponse.serverError(c, "Failed to delete release from Aptly repositories");
        }

        await RuntimeMetadata.removeOSReleasePendingPackageIfExists(release.id);

        await DB.instance().transaction(async (tx) => {
            await tx.delete(DB.Tables.stablePromotionRequests).where(
                eq(DB.Tables.stablePromotionRequests.package_release_id, release.id)
            );

            await tx.delete(DB.Tables.packageReleases).where(
                eq(DB.Tables.packageReleases.id, release.id)
            );
        });

        await TaskScheduler.enqueueTask("testing-repo:update", {}, { created_by_user_id: null });

        return APIResponse.successNoData(c, "Package release deleted successfully");
    }
);
