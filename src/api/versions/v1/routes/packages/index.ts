import { Hono } from "hono";
import { PackageModel } from '../../../../utils/shared-models/package';
import { validator as zValidator } from "hono-openapi";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { and, eq, like, or, SQL } from "drizzle-orm";
import { DB } from "../../../../../db";
import { APIResponse } from "../../../../utils/api-res";
import { AuthHandler } from "../../../../utils/authHandler";
import { PermissionHelper } from "../../../../../utils/permission-helper";
import { AptlyAPI } from "../../../../../aptly/api";
import { TaskScheduler } from "../../../../../tasks";
import { RuntimeMetadata } from "../../../../utils/metadata";
import { DOCS_TAGS } from "../../docs";
import { router as releasesRouter } from "./releases";
import { router as stableRequestsRouter } from "./stable-promotion-requests";
import { router as roleAssignmentsRouter } from "./role-assignments";
import { Utils } from "../../../../../utils";

export const router = new Hono().basePath('/packages');

router.get('/',

    APIRouteSpec.unauthenticated({
        summary: "List packages",
        description: "Retrieve a list of packages, optionally filtered by publisher or search string.",
        tags: [DOCS_TAGS.PACKAGES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Packages retrieved successfully", PackageModel.GetAll.Response)
        )
    }),

    zValidator("query", PackageModel.GetAll.Query),

    async (c) => {
        const { limit, offset, searchString, publisherID, publisherName } = c.req.valid("query");

        const filters: Array<SQL<unknown> | undefined> = [];

        if (publisherID !== undefined) {
            filters.push(eq(DB.Tables.packagesFullView.publisher_id, publisherID));
        } else if (publisherName !== undefined) {
            const publisher = await DB.instance()
                .select({ id: DB.Tables.publishers.id })
                .from(DB.Tables.publishers)
                .where(eq(DB.Tables.publishers.name, publisherName))
                .get();
            if (!publisher) {
                return APIResponse.success(c, "Packages retrieved successfully", []);
            }
            filters.push(eq(DB.Tables.packagesFullView.publisher_id, publisher.id));
        }

        if (searchString) {
            filters.push(
                or(
                    like(DB.Tables.packagesFullView.name, `%${searchString}%`),
                    like(DB.Tables.packagesFullView.display_name, `%${searchString}%`),
                    like(DB.Tables.packagesFullView.fullname, `%${searchString}%`)
                )
            );
        }

        const results = await DB.instance()
            .select()
            .from(DB.Tables.packagesFullView)
            .where(filters.length > 0 ? and(...filters) : undefined)
            .limit(limit)
            .offset(offset);

        return APIResponse.success(c, "Packages retrieved successfully", results satisfies PackageModel.GetAll.Response);
    }
);

// Create a new package
router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create a new package",
        description: "Create a new package under the given publisher. Requires packages.create permission on that publisher.",
        tags: [DOCS_TAGS.PACKAGES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.createdNoData("Package created successfully"),
            APIResponseSpec.conflict("Package with this name already exists in this publisher"),
            APIResponseSpec.forbidden("You do not have permission to create packages in this publisher"),
            APIResponseSpec.notFound("Publisher not found")
        )
    }),

    zValidator("json", PackageModel.CreatePackage.Body),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        const body = c.req.valid("json");

        if (authContext.type === "unauthenticated") {
            return APIResponse.unauthorized(c, "Authentication required");
        }

        const publisher = await DB.instance()
            .select({ id: DB.Tables.publishers.id })
            .from(DB.Tables.publishers)
            .where(eq(DB.Tables.publishers.id, body.publisher_id))
            .get();

        if (!publisher) {
            return APIResponse.notFound(c, "Publisher not found");
        }

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: publisher.id,
            check: (p) => p.packages.create
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to create packages in this publisher");
        }

        const existingPackage = await DB.instance()
            .select({ id: DB.Tables.packages.id })
            .from(DB.Tables.packages)
            .where(and(
                eq(DB.Tables.packages.publisher_id, publisher.id),
                eq(DB.Tables.packages.name, body.name)
            ))
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
                requires_patching: body.requires_patching
            })
            .returning()
            .get();

        return APIResponse.created(c, "Package created successfully", { id: result.id });
    }
);


// Loads the package (and its publisher) by :publisherName/:packageName for sub-routes.
router.use('/:fullPackageName/*',

    zValidator("param", PackageModel.Param),

    async (c, next) => {
        // @ts-ignore
        const { fullPackageName } = c.req.valid("param") as { fullPackageName: string };

        const row = await DB.instance().select().from(DB.Tables.packagesFullView).where(
            eq(DB.Tables.packagesFullView.fullname, fullPackageName)
        ).get();

        if (!row) {
            return APIResponse.notFound(c, "Package with specified name not found");
        }

        c.set(// @ts-ignore
            "package",
            row satisfies DB.Models.PackageFullView
        );

        return await next();
    }
);

router.get('/:fullPackageName',

    APIRouteSpec.unauthenticated({
        summary: "Get package details",
        description: "Retrieve details of a specific package.",
        tags: [DOCS_TAGS.PACKAGES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Package retrieved successfully", PackageModel.GetPackageByFullName.Response),
            APIResponseSpec.notFound("Package with specified name not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const pkg = c.get("package") as DB.Models.PackageFullView;

        return APIResponse.success(c, "Package retrieved successfully", Utils.asExact<PackageModel.GetPackageByFullName.Response>()(pkg));
    }
);

router.put('/:fullPackageName',

    APIRouteSpec.authenticated({
        summary: "Update package details",
        description: "Update details of a specific package. Requires packages.update permission.",
        tags: [DOCS_TAGS.PACKAGES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Package updated successfully"),
            APIResponseSpec.notFound("Package with specified name not found"),
            APIResponseSpec.forbidden("System-managed packages cannot be updated / You do not have permission to update this package")
        )
    }),

    zValidator("json", PackageModel.UpdatePackage.Body),

    async (c) => {
        // @ts-ignore
        const pkg = c.get("package") as DB.Models.PackageFullView
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        const updateData = c.req.valid("json");

        if (pkg.flags.includes("SYSTEM-MANAGED")) {
            return APIResponse.forbidden(c, "System-managed packages cannot be updated");
        }

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: pkg.publisher_id,
            packageId: pkg.id,
            check: (p) => p.packages.update
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to update this package");
        }

        await DB.instance().update(DB.Tables.packages).set(updateData).where(
            eq(DB.Tables.packages.id, pkg.id)
        );

        return APIResponse.successNoData(c, "Package updated successfully");
    }
);

router.delete('/:fullPackageName',

    APIRouteSpec.authenticated({
        summary: "Delete a package",
        description: "Delete a specific package and its releases. Requires packages.delete permission.",
        tags: [DOCS_TAGS.PACKAGES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Package deleted successfully"),
            APIResponseSpec.notFound("Package with specified name not found"),
            APIResponseSpec.forbidden("System-managed packages cannot be deleted / You do not have permission to delete this package"),
            APIResponseSpec.serverError("Failed to delete package from Aptly repositories")
        )
    }),

    async (c) => {
        // @ts-ignore
        const pkg = c.get("package") as DB.Models.PackageFullView;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        if (pkg.flags.includes("SYSTEM-MANAGED")) {
            return APIResponse.forbidden(c, "System-managed packages cannot be deleted");
        }

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: pkg.publisher_id,
            packageId: pkg.id,
            check: (p) => p.packages.delete
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to delete this package");
        }

        const packageReleaseIDs = await DB.instance().select({
            id: DB.Tables.packageReleases.id
        }).from(DB.Tables.packageReleases).where(
            eq(DB.Tables.packageReleases.package_id, pkg.id)
        );

        let aptlyDeleted: boolean;

        try {
            aptlyDeleted = await AptlyAPI.Packages.deleteAllInAllRepos(pkg.name);
        } catch {
            return APIResponse.serverError(c, "Failed to delete package from Aptly repositories");
        }

        if (!aptlyDeleted) {
            return APIResponse.serverError(c, "Failed to delete package from Aptly repositories");
        }

        for (const pkgRelease of packageReleaseIDs) {
            await RuntimeMetadata.removeOSReleasePendingPackageIfExists(pkgRelease.id);
        }

        await DB.instance().transaction(async (tx) => {
            await tx.delete(DB.Tables.stablePromotionRequests).where(
                eq(DB.Tables.stablePromotionRequests.package_id, pkg.id)
            );

            await tx.delete(DB.Tables.packageReleases).where(
                eq(DB.Tables.packageReleases.package_id, pkg.id)
            );

            await tx.delete(DB.Tables.packages).where(
                eq(DB.Tables.packages.id, pkg.id)
            );
        });

        await TaskScheduler.enqueueTask("testing-repo:update", {}, { created_by_user_id: null });

        return APIResponse.successNoData(c, "Package deleted successfully");
    }
);

router.route('/:fullPackageName', releasesRouter);
router.route('/:fullPackageName', stableRequestsRouter);
router.route('/:fullPackageName', roleAssignmentsRouter);
