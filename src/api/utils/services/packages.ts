import type { Context } from "hono";
import { DB } from "../../../db";
import { APIResponse } from "../api-res";
import { PackageModel } from "../shared-models/package";
import { eq, and, or } from "drizzle-orm";
import { AuthHandler } from "../authHandler";
import { AptlyAPI } from "../../../aptly/api";
import { TaskScheduler } from "../../../tasks";
import { RuntimeMetadata } from "../metadata";
import { PermissionsService } from "./permissions";

export class PackagesService {

    /**
     * Get all packages (optionally filter by publisher/group)
     */
    static async getAllPackages(c: Context, options: {
        publisherId?: number;
        groupId?: number;
        asAdmin?: boolean;
    } = {}) {
        const { publisherId, groupId, asAdmin = false } = options;

        let query = DB.instance().select().from(DB.Schema.packages);

        if (publisherId !== undefined) {
            if (groupId !== undefined) {
                query = query.where(and(
                    eq(DB.Schema.packages.publisher_id, publisherId),
                    eq(DB.Schema.packages.group_id, groupId)
                )) as any;
            } else {
                query = query.where(eq(DB.Schema.packages.publisher_id, publisherId)) as any;
            }
        }

        const packages = await query.all();

        return APIResponse.success(c, "Packages retrieved successfully", packages);
    }

    /**
     * Create a package in a publisher/group
     * Requires the full context including publisher and optional group
     */
    static async createPackage(
        c: Context, 
        packageData: PackageModel.CreatePackage.Body,
        publisherName: string,
        groupPath: string[], // Array of group names for nested groups
        authContext: AuthHandler.AuthContext,
        asAdmin: boolean = false
    ): Promise<APIResponse.Types.BasicReturnData> {

        // Resolve publisher
        const publisher = await DB.instance()
            .select()
            .from(DB.Schema.publishers)
            .where(eq(DB.Schema.publishers.name, publisherName))
            .get();

        if (!publisher) {
            return APIResponse.notFound(c, "Publisher not found");
        }

        // Resolve group (if groupPath provided)
        let groupId: number | null = null;
        if (groupPath.length > 0) {
            let currentParentId: number | null = null;
            
            for (const groupName of groupPath) {
                const group = await DB.instance()
                    .select()
                    .from(DB.Schema.publisherGroups)
                    .where(and(
                        eq(DB.Schema.publisherGroups.publisher_id, publisher.id),
                        eq(DB.Schema.publisherGroups.name, groupName),
                        currentParentId === null
                            ? eq(DB.Schema.publisherGroups.parent_group_id, null as any)
                            : eq(DB.Schema.publisherGroups.parent_group_id, currentParentId)
                    ))
                    .get();

                if (!group) {
                    return APIResponse.notFound(c, `Group '${groupName}' not found in hierarchy`);
                }

                currentParentId = group.id;
            }

            groupId = currentParentId;
        }

        // Check permissions (unless admin)
        if (!asAdmin) {
            const hasPermission = await PermissionsService.hasPermissionOrAdmin({
                authContext,
                publisherId: publisher.id,
                groupId: groupId ?? undefined,
                permission: 'canCreatePackages'
            });

            if (!hasPermission) {
                return APIResponse.forbidden(c, "You do not have permission to create packages in this publisher/group");
            }
        }

        // Construct full package name
        const fullPackageName = PackageModel.constructPackageName(
            publisherName,
            groupPath,
            packageData.name
        );

        // Check if package already exists
        const existingPackage = await DB.instance()
            .select()
            .from(DB.Schema.packages)
            .where(eq(DB.Schema.packages.name, fullPackageName))
            .get();

        if (existingPackage) {
            return APIResponse.conflict(c, "Package with this name already exists");
        }

        // Create package
        const result = await DB.instance()
            .insert(DB.Schema.packages)
            .values({
                name: fullPackageName,
                description: packageData.description,
                homepage_url: packageData.homepage_url,
                requires_patching: packageData.requires_patching,
                publisher_id: publisher.id,
                group_id: groupId,
                created_by_user_id: authContext.user_id
            })
            .returning()
            .get();

        return APIResponse.created(c, "Package created successfully", { id: result.id });
    }

    /**
     * Middleware to load package and verify permissions
     */
    static async packageMiddleware(
        c: Context, 
        next: () => Promise<void>, 
        packageName: string, 
        authContext: AuthHandler.AuthContext,
        asAdmin = false
    ) {
        // Load package
        const packageData = await DB.instance()
            .select()
            .from(DB.Schema.packages)
            .where(eq(DB.Schema.packages.name, packageName))
            .get();

        if (!packageData) {
            return APIResponse.notFound(c, "Package with specified name not found");
        }

        // Check permissions (unless admin or viewing public package)
        if (!asAdmin) {
            const hasPermission = await PermissionsService.hasPermissionOrAdmin({
                authContext,
                publisherId: packageData.publisher_id,
                groupId: packageData.group_id ?? undefined,
                permission: 'canEditPackages'
            });

            if (!hasPermission) {
                return APIResponse.forbidden(c, "You do not have permission to access this package");
            }
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

    static async updatePackageAfterMiddleware(
        c: Context, 
        updateData: PackageModel.UpdatePackage.Body,
        authContext: AuthHandler.AuthContext,
        asAdmin: boolean = false
    ) {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        if (packageData.flags.includes("SYSTEM-MANAGED")) {
            return APIResponse.forbidden(c, "System-managed packages cannot be updated");
        }

        // Check permissions (middleware already verified canEditPackages, 
        // but let's be explicit for updates)
        if (!asAdmin) {
            const hasPermission = await PermissionsService.hasPermissionOrAdmin({
                authContext,
                publisherId: packageData.publisher_id,
                groupId: packageData.group_id ?? undefined,
                permission: 'canEditPackages'
            });

            if (!hasPermission) {
                return APIResponse.forbidden(c, "You do not have permission to update this package");
            }
        }

        await DB.instance().update(DB.Schema.packages).set(updateData).where(
            eq(DB.Schema.packages.id, packageData.id)
        );

        return APIResponse.successNoData(c, "Package updated successfully");
    }

    static async deletePackageAfterMiddleware(
        c: Context,
        authContext: AuthHandler.AuthContext,
        asAdmin: boolean = false
    ) {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        if (packageData.flags.includes("SYSTEM-MANAGED")) {
            return APIResponse.forbidden(c, "System-managed packages cannot be deleted");
        }

        // Check delete permission
        if (!asAdmin) {
            const hasPermission = await PermissionsService.hasPermissionOrAdmin({
                authContext,
                publisherId: packageData.publisher_id,
                groupId: packageData.group_id ?? undefined,
                permission: 'canDeletePackages'
            });

            if (!hasPermission) {
                return APIResponse.forbidden(c, "You do not have permission to delete this package");
            }
        }

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

        await TaskScheduler.enqueueTask("testing-repo:update", {}, { created_by_user_id: null });
        // @TODO: Enqueue a task to update the stable repo as well

        return APIResponse.successNoData(c, "Package deleted successfully");
    }

    // Keep old method name for backward compatibility with admin routes
    static async deletePackageAfterMiddlewareAsAdmin(c: Context) {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        return await this.deletePackageAfterMiddleware(c, authContext, true);
    }
}
