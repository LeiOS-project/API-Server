import type { Context } from "hono";
import { DB } from "../../../db";
import { APIResponse } from "../api-res";
import { PackageModel } from "../shared-models/package";
import { eq, and, or, sql } from "drizzle-orm";
import { AuthHandler } from "../authHandler";
import { AptlyAPI } from "../../../aptly/api";
import { AptlyUtils } from "../../../aptly/utils";
import { TaskScheduler } from "../../../tasks";
import { RuntimeMetadata } from "../metadata";
import { PackageReleaseModel } from "../shared-models/pkg-releases";

export class PkgReleasesService {

    static async getAllReleases(c: Context) {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        const releases = await DB.instance().select().from(DB.Schema.packageReleases).where(
            eq(DB.Schema.packageReleases.package_id, packageData.id)
        );

        return APIResponse.success(c, "Package releases retrieved successfully", releases satisfies PackageReleaseModel.GetAll.Response);
    }

    static async createRelease(c: Context, releaseData: PackageReleaseModel.CreateRelease.Body) {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        if (packageData.flags.includes("SYSTEM-MANAGED")) {
            return APIResponse.forbidden(c, "System-managed packages cannot have new releases created");
        }

        if (packageData.requires_patching) {
            const matches = releaseData.versionWithLeiosPatch.match(PackageReleaseModel.versionWithRequiredLeiOSPatchRegex);
            if (!matches) {
                return APIResponse.badRequest(c, "Package requires leios patch suffix in version but is missing in version argument");
            }
        }

        const owner = DB.instance().select().from(DB.Schema.users).where(
            eq(DB.Schema.users.id, packageData.owner_user_id)
        ).get();
        if (!owner) {
            throw new Error("User is authenticated but not found in database");
        }

        const existingRelease = DB.instance().select().from(DB.Schema.packageReleases).where(
            and(
                eq(DB.Schema.packageReleases.package_id, packageData.id),
                eq(DB.Schema.packageReleases.versionWithLeiosPatch, releaseData.versionWithLeiosPatch),
            )
        ).get();

        if (existingRelease) {
            return APIResponse.conflict(c, "Package release with this version already exists");
        }

        await DB.instance().insert(DB.Schema.packageReleases).values({
            package_id: packageData.id,
            ...releaseData,
            architectures: []
        });

        return APIResponse.createdNoData(c, "Package release created successfully");

    }

    static async pkgReleaseMiddleware(c: Context, next: () => Promise<void>, versionWithLeiosPatch: string) {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;
        
        const releaseData = DB.instance().select().from(DB.Schema.packageReleases).where(and(
            eq(DB.Schema.packageReleases.package_id, packageData.id),
            eq(DB.Schema.packageReleases.versionWithLeiosPatch, versionWithLeiosPatch)
        )).get();

        // @ts-ignore
        c.set("release", releaseData);

        await next();
    }

    static async getPkgReleaseAfterMiddleware(c: Context) {
        // @ts-ignore
        const releaseData = c.get("release") as DB.Models.PackageRelease;

        return APIResponse.success(c, "Package release retrieved successfully", releaseData satisfies PackageReleaseModel.GetReleaseByVersion.Response);
    }


    static async updatePkgReleaseAfterMiddleware(c: Context, updateData: PackageReleaseModel.UpdateRelease.Body) {
        
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        if (packageData.flags.includes("SYSTEM-MANAGED")) {
            return APIResponse.forbidden(c, "System-managed packages cannot have their releases updated");
        }

        // @ts-ignore
        const releaseData = c.get("release") as DB.Models.PackageRelease;

        await DB.instance().update(DB.Schema.packageReleases).set(updateData).where(
            eq(DB.Schema.packageReleases.id, releaseData.id)
        );

        return APIResponse.successNoData(c, "Package release updated successfully");
    }


    static async uploadReleaseAssetAfterMiddleware(c: Context, file: File, arch: "amd64" | "arm64", isAdmin = false) {
        // @ts-ignore
        const releaseData = c.get("release") as DB.Models.PackageRelease;

        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        if (packageData.flags.includes("SYSTEM-MANAGED")) {
            return APIResponse.forbidden(c, "System-managed packages cannot have their releases updated");
        }

        const owner = DB.instance().select().from(DB.Schema.users).where(
            eq(DB.Schema.users.id, packageData.owner_user_id)
        ).get();
        if (!owner) {
            throw new Error("User is authenticated but not found in database");
        }

        const existingArchForRelease = releaseData.architectures.includes(arch);

        if (existingArchForRelease) {
            return APIResponse.conflict(c, "Package release already contains a release for this architecture");
        }

        try {
            const result = await AptlyAPI.Packages.uploadAndVerifyIntoArchiveRepo({
                    name: packageData.name,
                    versionWithLeiosPatch: releaseData.versionWithLeiosPatch,
                    architecture: arch,
                    maintainer_name: owner.display_name,
                    maintainer_email: owner.email
                },
                file,
                isAdmin
            );

            if (!result) {
                return APIResponse.serverError(c, "Failed to upload and verify package release asset");
            }

            // cleanup everything in testing repo first but ensure we only cleanup for this architecture
            const cleanupResult = await AptlyAPI.Packages.deleteInRepo("leios-testing", packageData.name, undefined, arch);
            if (!cleanupResult) {
                return APIResponse.serverError(c, "Failed to clean up existing package releases in testing repository");
            }

            const copyResult = await AptlyAPI.Packages.copyIntoRepo("leios-testing", packageData.name, releaseData.versionWithLeiosPatch, arch);
            if (!copyResult) {
                return APIResponse.serverError(c, "Failed to copy package release into testing repository");
            }

            await TaskScheduler.enqueueTask("testing-repo:update", {}, { created_by_user_id: null });

            releaseData.architectures.push(arch);

            await DB.instance().update(DB.Schema.packageReleases).set({
                package_id: packageData.id,
                architectures: releaseData.architectures
            });

            if (arch === "amd64") {
                await DB.instance().update(DB.Schema.packages).set({
                    latest_testing_release_amd64: releaseData.versionWithLeiosPatch
                }).where(
                    eq(DB.Schema.packages.id, packageData.id)
                );
            } else if (arch === "arm64") {
                await DB.instance().update(DB.Schema.packages).set({
                    latest_testing_release_arm64: releaseData.versionWithLeiosPatch
                }).where(
                    eq(DB.Schema.packages.id, packageData.id)
                );
            }

        } catch (error) {
            return APIResponse.serverError(c, "Failed to upload and verify package release: " + error);
        }

        return APIResponse.createdNoData(c, "Package release file uploaded successfully");

    }

    static async deletePkgReleaseAfterMiddlewareAsAdmin(c: Context) {
        // @ts-ignore
        const releaseData = c.get("release") as DB.Models.PackageRelease;

        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        if (packageData.flags.includes("SYSTEM-MANAGED")) {
            return APIResponse.forbidden(c, "System-managed packages cannot have their releases deleted");
        }

        await RuntimeMetadata.removeOSReleasePendingPackageIfExists(releaseData.id);

        await DB.instance().delete(DB.Schema.packageReleases).where(
            eq(DB.Schema.packageReleases.id, releaseData.id)
        );

        await DB.instance().delete(DB.Schema.stablePromotionRequests).where(
            eq(DB.Schema.stablePromotionRequests.package_release_id, releaseData.id)
        );

        await AptlyAPI.Packages.deleteAllInAllRepos(packageData.name, releaseData.versionWithLeiosPatch, undefined);

        await TaskScheduler.enqueueTask("testing-repo:update", {}, { created_by_user_id: null });
        
        return APIResponse.successNoData(c, "Package release deleted successfully");
    }
}
