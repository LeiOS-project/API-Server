import { Context } from "hono";
import { DB } from "../../../db";
import { APIResponse } from "../api-res";
import { PackageModel } from "../shared-models/package";
import { eq, and, or } from "drizzle-orm";
import { AuthHandler } from "../authHandler";
import { AptlyAPI } from "../../../aptly/api";
import { TaskScheduler } from "../../../tasks";
import { RuntimeMetadata } from "../metadata";

export class PackagesService {

    static async getAllPackages(c: Context, asAdmin = false) {
        if (!asAdmin) {

            // @ts-ignore
            const authContext = c.get("authContext") as AuthHandler.AuthContext;

            const packages = await DB.instance().select().from(DB.Schema.packages).where(
                eq(DB.Schema.packages.owner_user_id, authContext.user_id)
            );

            return APIResponse.success(c, "Packages retrieved successfully", packages);
        } else {

            const packages = await DB.instance().select().from(DB.Schema.packages);

            return APIResponse.success(c, "Packages retrieved successfully", packages);
        }
    }

    static async createPackage(c: Context, packageData: PackageModel.CreatePackage.Body | PackageModel.CreatePackageAsAdmin.Body, asAdmin = false) {

        if (asAdmin) {

            if (!(packageData as PackageModel.CreatePackageAsAdmin.Body).owner_user_id) {
                throw new Error("owner_user_id must be provided when creating package as admin");
            }

            const owner = DB.instance().select().from(DB.Schema.users).where(
                eq(DB.Schema.users.id, (packageData as PackageModel.CreatePackageAsAdmin.Body).owner_user_id),
            ).get();

            if (!owner || (owner.role !== 'developer' && owner.role !== 'admin')) {
                return APIResponse.badRequest(c, "Owner user ID does not correspond to a developer account");
            }
        }

        const existingPackage = DB.instance().select().from(DB.Schema.packages).where(eq(DB.Schema.packages.name, packageData.name)).get();
        if (existingPackage) {
            return APIResponse.conflict(c, "Package with this name already exists");
        }

        if (!asAdmin) {
            // @ts-ignore
            const authContext = c.get("authContext") as AuthHandler.AuthContext;

            const result = DB.instance().insert(DB.Schema.packages).values({
                ...packageData,
                owner_user_id: authContext.user_id
            }).returning().get();

            return APIResponse.created(c, "Package created successfully", { id: result.id });

        } else {
            const result = DB.instance().insert(DB.Schema.packages).values(packageData as PackageModel.CreatePackageAsAdmin.Body).returning().get();

            return APIResponse.created(c, "Package created successfully", { id: result.id });
        }
    }

    static async packageMiddleware(c: Context, next: () => Promise<void>, packageName: string, asAdmin = false) {

        let packageData: DB.Models.Package | undefined;

        if (!asAdmin) {
            // @ts-ignore
            const authContext = c.get("authContext") as AuthHandler.AuthContext;

            packageData = DB.instance().select().from(DB.Schema.packages).where(and(
                eq(DB.Schema.packages.name, packageName),
                eq(DB.Schema.packages.owner_user_id, authContext.user_id)
            )).get();

        } else {
            packageData = DB.instance().select().from(DB.Schema.packages).where(
                eq(DB.Schema.packages.name, packageName)
            ).get();
        }

        if (!packageData) {
            return APIResponse.notFound(c, "Package with specified ID not found");
        }
        // @ts-ignore
        c.set("package", packageData);

        await next();
    }

    static async getPackageAfterMiddleware(c: Context) {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        return APIResponse.success(c, "Package retrieved successfully", packageData);
    }

    static async updatePackageAfterMiddleware(c: Context, updateData: PackageModel.UpdatePackage.Body) {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        await DB.instance().update(DB.Schema.packages).set(updateData).where(
            eq(DB.Schema.packages.id, packageData.id)
        );

        return APIResponse.successNoData(c, "Package updated successfully");
    }

    static async deletePackageAfterMiddlewareAsAdmin(c: Context) {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        const packageReleaseIDs = await DB.instance().select({
            id: DB.Schema.packageReleases.id
        }).from(DB.Schema.packageReleases).where(
            eq(DB.Schema.packageReleases.package_id, packageData.id)
        );

        for (const pkgRelease of packageReleaseIDs) {
            await RuntimeMetadata.removeOSReleasePendingPackageIfExists(pkgRelease.id);
        }

        await DB.instance().delete(DB.Schema.packageReleases).where(
            eq(DB.Schema.packageReleases.package_id, packageData.id)
        );

        await DB.instance().delete(DB.Schema.packages).where(
            eq(DB.Schema.packages.id, packageData.id)
        );

        await DB.instance().delete(DB.Schema.stablePromotionRequests).where(
            eq(DB.Schema.stablePromotionRequests.package_id, packageData.id)
        );

        await AptlyAPI.Packages.deleteAllInAllRepos(packageData.name);

        await TaskScheduler.enqueueTask("testing-repo:update", {}, { created_by_user_id: null, tag: "update-testing-repo-after-package-deletion" });
        // @TODO: Enqueue a task to update the stable reo as well

        return APIResponse.successNoData(c, "Package deleted successfully");

    }
}
