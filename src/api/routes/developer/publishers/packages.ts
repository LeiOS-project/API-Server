import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { PackageModel } from "../../../utils/shared-models/package";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { PackagesService } from "../../../utils/services/packages";
import { DOCS_TAGS } from "../../../docs";
import { AuthHandler } from "../../../utils/authHandler";
import { APIResponse } from "../../../utils/api-res";
import { DB } from "../../../../db";
import { eq, and } from "drizzle-orm";

export const router = new Hono().basePath('/packages');

// List packages in publisher (optionally filtered by group)
router.get('/',

    APIRouteSpec.authenticated({
        summary: "List packages",
        description: "Retrieve all packages in a publisher (or specific group).",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_PACKAGES],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Packages retrieved successfully", PackageModel.GetAll.Response)
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string()
    })),

    zValidator("query", z.object({
        groupId: z.coerce.number().optional(),
        groupPath: z.string().optional() // e.g., "group1.group2" for nested groups
    })),

    async (c) => {
        // @ts-ignore
        const { publisherName } = c.req.valid("param") as { publisherName: string };
        const { groupId, groupPath } = c.req.valid("query");

        // Get publisher
        const publisher = await DB.instance()
            .select()
            .from(DB.Schema.publishers)
            .where(eq(DB.Schema.publishers.name, publisherName))
            .get();

        if (!publisher) {
            return APIResponse.notFound(c, "Publisher not found");
        }

        // Resolve group if groupPath provided
        let resolvedGroupId = groupId;
        if (groupPath && !groupId) {
            const groupNames = groupPath.split('.');
            let currentParentId: number | null = null;

            for (const groupName of groupNames) {
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

            resolvedGroupId = currentParentId ?? undefined;
        }

        return await PackagesService.getAllPackages(c, {
            publisherId: publisher.id,
            groupId: resolvedGroupId
        });
    }
);

// Create package in publisher/group
router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create package",
        description: "Create a new package in the publisher or specific group. Package name will be constructed as publisher.group.pkgname",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_PACKAGES],
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.createdNoData("Package created successfully"),
            APIResponseSpec.conflict("Package with this name already exists"),
            APIResponseSpec.forbidden("You do not have permission to create packages")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string()
    })),

    zValidator("query", z.object({
        groupPath: z.string().optional() // e.g., "group1.group2" for hierarchy
    })),

    zValidator("json", PackageModel.CreatePackage.Body),

    async (c) => {
        // @ts-ignore
        const { publisherName } = c.req.valid("param") as { publisherName: string };
        const { groupPath } = c.req.valid("query");
        const packageData = c.req.valid("json");
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        const groups = groupPath ? groupPath.split('.') : [];

        return await PackagesService.createPackage(
            c,
            packageData,
            publisherName,
            groups,
            authContext,
            false
        );
    }
);

// Get specific package
router.get('/:packageName',

    APIRouteSpec.authenticated({
        summary: "Get package",
        description: "Retrieve details of a specific package in the publisher.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_PACKAGES],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Package retrieved successfully", PackageModel.GetPackageByName.Response),
            APIResponseSpec.notFound("Package not found"),
            APIResponseSpec.forbidden("You do not have permission to access this package")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string(),
        packageName: z.string()
    })),

    async (c) => {
        // @ts-ignore
        const { publisherName, packageName } = c.req.valid("param") as { publisherName: string; packageName: string };
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        // Construct full package name
        const fullPackageName = `${publisherName}.${packageName}`;

        // Use middleware to load and check permissions
        await PackagesService.packageMiddleware(c, async () => {}, fullPackageName, authContext, false);

        return await PackagesService.getPackageAfterMiddleware(c);
    }
);

// Update package
router.put('/:packageName',

    APIRouteSpec.authenticated({
        summary: "Update package",
        description: "Update package details. Requires canEditPackages permission.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_PACKAGES],
        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Package updated successfully"),
            APIResponseSpec.notFound("Package not found"),
            APIResponseSpec.forbidden("You do not have permission to update this package")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string(),
        packageName: z.string()
    })),

    zValidator("json", PackageModel.UpdatePackage.Body),

    async (c) => {
        // @ts-ignore
        const { publisherName, packageName } = c.req.valid("param") as { publisherName: string; packageName: string };
        const updateData = c.req.valid("json");
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        // Construct full package name
        const fullPackageName = `${publisherName}.${packageName}`;

        // Use middleware to load and check permissions
        const middlewareResult = await PackagesService.packageMiddleware(c, async () => {}, fullPackageName, authContext, false);
        if (middlewareResult) return middlewareResult;

        return await PackagesService.updatePackageAfterMiddleware(c, updateData, authContext, false);
    }
);

// Delete package
router.delete('/:packageName',

    APIRouteSpec.authenticated({
        summary: "Delete package",
        description: "Delete a package. Requires canDeletePackages permission.",
        tags: [DOCS_TAGS.DEV_API.PUBLISHERS_PACKAGES],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Package deleted successfully"),
            APIResponseSpec.notFound("Package not found"),
            APIResponseSpec.forbidden("You do not have permission to delete this package or package is system-managed")
        )
    }),

    zValidator("param", z.object({
        publisherName: z.string(),
        packageName: z.string()
    })),

    async (c) => {
        // @ts-ignore
        const { publisherName, packageName } = c.req.valid("param") as { publisherName: string; packageName: string };
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        // Construct full package name
        const fullPackageName = `${publisherName}.${packageName}`;

        // Use middleware to load and check permissions
        const middlewareResult = await PackagesService.packageMiddleware(c, async () => {}, fullPackageName, authContext, false);
        if (middlewareResult) return middlewareResult;

        return await PackagesService.deletePackageAfterMiddleware(c, authContext, false);
    }
);
