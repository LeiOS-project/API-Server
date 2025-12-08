import { Context } from "hono";
import { DB } from "../../../db";
import { APIResponse } from "../api-res";
import { PackageModel } from "../shared-models/package";
import { eq, and, or, sql } from "drizzle-orm";
import { AuthHandler } from "../authHandler";
import { AptlyAPI } from "../../../aptly/api";
import { AptlyUtils } from "../../../aptly/utils";

export class PkgReleasesService {

    static async getAllReleases(c: Context) {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        const releases = await DB.instance().select().from(DB.Schema.packageReleases).where(
            eq(DB.Schema.packageReleases.package_id, packageData.id)
        );

        return APIResponse.success(c, "Package releases retrieved successfully", releases);
    }

    static async createRelease(c: Context, file: File, version: string, arch: "amd64" | "arm64", leios_patch: string | null, isAdmin = false) {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        const owner = DB.instance().select().from(DB.Schema.users).where(
            eq(DB.Schema.users.id, packageData.owner_user_id)
        ).get();
        if (!owner) {
            throw new Error("User is authenticated but not found in database");
        }

        const existingRelease = DB.instance().select().from(DB.Schema.packageReleases).where(
            and(
                eq(DB.Schema.packageReleases.package_id, packageData.id),
                eq(DB.Schema.packageReleases.version, version),
                eq(DB.Schema.packageReleases.architecture, arch),
                leios_patch ? eq(DB.Schema.packageReleases.leios_patch, leios_patch) : sql`1=1`
            )
        ).get();

        if (existingRelease) {
            return APIResponse.conflict(c, "Package release with this version already exists");
        }

        try {
            const result = await AptlyAPI.Packages.uploadAndVerify(
                "leios-archive",
                {
                    name: packageData.name,
                    version,
                    architecture: arch,
                    maintainer_name: owner.display_name,
                    maintainer_email: owner.email,
                    leios_patch: leios_patch || undefined
                },
                file,
                isAdmin
            );

            if (!result) {
                return APIResponse.serverError(c, "Failed to upload and verify package release");
            }

            // cleanup everything in testing repo first
            const cleanupResult = await AptlyAPI.Packages.deleteInRepo("leios-testing", packageData.name);
            if (!cleanupResult) {
                return APIResponse.serverError(c, "Failed to clean up existing package releases in testing repository");
            }

            const copyResult = await AptlyAPI.Packages.copyIntoRepo("leios-testing", packageData.name, version, undefined, arch);
            if (!copyResult) {
                return APIResponse.serverError(c, "Failed to copy package release into testing repository");
            }

            await DB.instance().insert(DB.Schema.packageReleases).values({
                package_id: packageData.id,
                version,
                leios_patch: leios_patch ?? null,
                architecture: arch
            });

            if (arch === "amd64") {
                await DB.instance().update(DB.Schema.packages).set({
                    latest_stable_release_amd64: AptlyUtils.buildVersionWithLeiOSSuffix(version, leios_patch)
                }).where(
                    eq(DB.Schema.packages.id, packageData.id)
                );
            } else if (arch === "arm64") {
                await DB.instance().update(DB.Schema.packages).set({
                    latest_stable_release_arm64: AptlyUtils.buildVersionWithLeiOSSuffix(version, leios_patch)
                }).where(
                    eq(DB.Schema.packages.id, packageData.id)
                );
            }

        } catch (error) {
            return APIResponse.serverError(c, "Failed to upload and verify package release: " + error);
        }

        return APIResponse.created(c, "Package release created successfully", { version, arch });

    }

    static async pkgReleaseMiddleware(c: Context, next: () => Promise<void>, releaseID: number) {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;
        
        const releaseData = DB.instance().select().from(DB.Schema.packageReleases).where(and(
            eq(DB.Schema.packageReleases.id, releaseID),
            eq(DB.Schema.packageReleases.package_id, packageData.id)
        )).get();

        // @ts-ignore
        c.set("release", releaseData);

        await next();
    }

    static async getPkgReleaseAfterMiddleware(c: Context) {
        // @ts-ignore
        const releaseData = c.get("release") as DB.Models.PackageRelease;

        return APIResponse.success(c, "Package release retrieved successfully", releaseData);
    }

    static async deletePkgReleaseAfterMiddlewareAsAdmin(c: Context) {
        // @ts-ignore
        const releaseData = c.get("release") as DB.Models.PackageRelease;

        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        await DB.instance().delete(DB.Schema.packageReleases).where(
            eq(DB.Schema.packageReleases.id, releaseData.id)
        );
        await AptlyAPI.Packages.deleteAllInAllRepos(packageData.name, releaseData.version, releaseData.leios_patch || undefined, releaseData.architecture);
        
        return APIResponse.successNoData(c, "Package release deleted successfully");
    }
}
