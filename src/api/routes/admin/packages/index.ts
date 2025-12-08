import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { PackageModel } from "../../../utils/shared-models/package";
import { PackagesService } from "../../../utils/services/packages";

export const router = new Hono().basePath('/packages');

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List packages",
        description: "Retrieve a list of all packages.",
        tags: [DOCS_TAGS.ADMIN_API.PACKAGES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Packages retrieved successfully", PackageModel.GetAll.Response)
        )
    }),

    async (c) => {
        return await PackagesService.getAllPackages(c, true);
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create a new package",
        description: "Create a new package under the authenticated developer's account.",
        tags: [DOCS_TAGS.ADMIN_API.PACKAGES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.created("Package created successfully", PackageModel.CreatePackageAsAdmin.Response),
            APIResponseSpec.badRequest("Owner user ID does not correspond to a developer account"),
            APIResponseSpec.conflict("Package with this name already exists")
        )
    }),

    zValidator("json", PackageModel.CreatePackageAsAdmin.Body),

    async (c) => {
        const packageData = c.req.valid("json");

        return await PackagesService.createPackage(c, packageData, true);
    }
);

router.use('/:packageID/*',

    zValidator("param", z.object({
        packageID: z.coerce.number().int().positive()
    })),

    async (c, next) => {
        // @ts-ignore
        const { packageID } = c.req.valid("param") as { packageID: number };

        return await PackagesService.packageMiddleware(c, next, packageID, true);
    }
);

router.get('/:packageID',

    APIRouteSpec.authenticated({
        summary: "Get package details",
        description: "Retrieve details of a specific package.",
        tags: [DOCS_TAGS.ADMIN_API.PACKAGES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Package retrieved successfully", PackageModel.GetPackageById.Response),
            APIResponseSpec.notFound("Package with specified ID not found")
        )
    }),

    async (c) => {
        return await PackagesService.getPackageAfterMiddleware(c);
    }
);

router.put('/:packageID',

    APIRouteSpec.authenticated({
        summary: "Update package details",
        description: "Update details of a specific package owned by the authenticated developer.",
        tags: [DOCS_TAGS.ADMIN_API.PACKAGES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Package updated successfully"),
            APIResponseSpec.notFound("Package with specified ID not found")
        )
    }),

    zValidator("json", PackageModel.UpdatePackage.Body),

    async (c) => {
        const updateData = c.req.valid("json");

        return await PackagesService.updatePackageAfterMiddleware(c, updateData);
    }
);

router.delete('/:packageID',

    APIRouteSpec.authenticated({
        summary: "Delete a package",
        description: "Delete a specific package owned by the authenticated developer.",
        tags: [DOCS_TAGS.ADMIN_API.PACKAGES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Package deleted successfully"),
            APIResponseSpec.notFound("Package with specified ID not found")
        )
    }),

    async (c) => {
        return await PackagesService.deletePackageAfterMiddlewareAsAdmin(c);
    }
);


// router.get('/stable-requests',

//     APIRouteSpec.authenticated({
//         summary: "List stable promotion requests",
//         description: "Retrieve stable promotion requests with optional status filtering.",
//         tags: [DOCS_TAGS.ADMIN_API.PACKAGES_STABLE_REQUESTS],
//         responses: APIResponseSpec.describeBasic(
//             APIResponseSpec.success("Stable promotion requests retrieved successfully", StableRequestModel.List.Response)
//         )
//     }),

//     zValidator("query", StableRequestModel.List.Query),

//     async (c) => {
//         const filters = c.req.valid("query") as z.infer<typeof StableRequestModel.List.Query>;

//         let query = DB.instance().select().from(DB.Schema.stablePromotionRequests).$dynamic();
//         if (filters.status) {
//             query = query.where(eq(DB.Schema.stablePromotionRequests.status, filters.status));
//         }

//         const requests = await query;
//         return APIResponse.success(c, "Stable promotion requests retrieved successfully", requests);
//     }
// );

// router.post('/stable-requests/:requestId/decision',

//     APIRouteSpec.authenticated({
//         summary: "Decide on stable promotion request",
//         description: "Approve or deny a developer's request to promote a package version into the stable repository.",
//         tags: [ADMIN_STABLE_REQUESTS_TAG],
//         responses: APIResponseSpec.describeWithWrongInputs(
//             APIResponseSpec.success("Stable promotion request updated", StableRequestModel.Entity),
//             APIResponseSpec.notFound("Stable promotion request not found"),
//             APIResponseSpec.conflict("Stable promotion request already resolved"),
//             APIResponseSpec.serverError("Failed to copy package into stable repository")
//         )
//     }),

//     zValidator("param", AdminPackageModel.StableRequestIdParams),
//     zValidator("json", StableRequestModel.Decision.Body),

//     async (c) => {
//         // @ts-ignore
//         const authContext = c.get("authContext") as AuthHandler.AuthContext;
//         // @ts-ignore
//         const { requestId } = c.req.valid("param") as z.infer<typeof AdminPackageModel.StableRequestIdParams>;
//         const decisionBody = c.req.valid("json") as StableRequestModel.Decision.Body;

//         const request = DB.instance().select().from(DB.Schema.stablePromotionRequests).where(
//             eq(DB.Schema.stablePromotionRequests.id, requestId)
//         ).get();

//         if (!request) {
//             return APIResponse.notFound(c, "Stable promotion request not found");
//         }

//         if (request.status !== 'pending') {
//             return APIResponse.conflict(c, "Stable promotion request already resolved");
//         }

//         if (decisionBody.decision === 'approve') {
//             const alreadyStable = await AptlyAPI.Packages.existsInRepo(
//                 "leios-stable",
//                 request.package_name,
//                 request.version,
//                 request.leios_patch as number | undefined,
//                 request.architecture as AptlyAPI.Utils.Architectures
//             );

//             if (!alreadyStable) {
//                 const existsInArchive = await AptlyAPI.Packages.existsInRepo(
//                     "leios-archive",
//                     request.package_name,
//                     request.version,
//                     request.leios_patch as number | undefined,
//                     request.architecture as AptlyAPI.Utils.Architectures
//                 );

//                 if (!existsInArchive) {
//                     return APIResponse.notFound(c, "Requested version not found in archive repository");
//                 }

//                 try {
//                     await AptlyAPI.Packages.copyIntoRepo(
//                         "leios-stable",
//                         request.package_name,
//                         request.version,
//                         request.leios_patch as number | undefined,
//                         request.architecture as AptlyAPI.Utils.Architectures
//                     );
//                 } catch (error) {
//                     return APIResponse.serverError(c, "Failed to copy package into stable repository: " + error);
//                 }
//             }
//         }

//         await DB.instance().update(DB.Schema.stablePromotionRequests).set({
//             status: decisionBody.decision === 'approve' ? 'approved' : 'denied',
//             reviewed_by: authContext.user_id,
//             decision_reason: decisionBody.reason ?? null,
//         }).where(
//             eq(DB.Schema.stablePromotionRequests.id, requestId)
//         ).run();

//         const updatedRequest = DB.instance().select().from(DB.Schema.stablePromotionRequests).where(
//             eq(DB.Schema.stablePromotionRequests.id, requestId)
//         ).get();

//         return APIResponse.success(c, "Stable promotion request updated", updatedRequest!);
//     }
// );

// router.get('/:packageName/stable-requests',

//     APIRouteSpec.authenticated({
//         summary: "List package stable requests",
//         description: "List stable promotion requests for a specific package.",
//         tags: [ADMIN_STABLE_REQUESTS_TAG],
//         responses: APIResponseSpec.describeBasic(
//             APIResponseSpec.success("Stable promotion requests retrieved successfully", StableRequestModel.List.Response),
//             APIResponseSpec.notFound("Package not found")
//         )
//     }),

//     zValidator("query", StableRequestModel.List.Query),

//     async (c) => {
//         // @ts-ignore
//         const pkg = c.get("package") as DB.Models.Package;
//         const filters = c.req.valid("query") as z.infer<typeof StableRequestModel.List.Query>;

//         let query = DB.instance().select().from(DB.Schema.stablePromotionRequests).where(
//             eq(DB.Schema.stablePromotionRequests.package_name, pkg.name)
//         ).$dynamic();

//         if (filters.status) {
//             query = query.where(eq(DB.Schema.stablePromotionRequests.status, filters.status));
//         }

//         const requests = await query;
//         return APIResponse.success(c, "Stable promotion requests retrieved successfully", requests);
//     }
// );

// router.post('/:packageName/stable',

//     APIRouteSpec.authenticated({
//         summary: "Promote package version to stable",
//         description: "Copy a package version from archive into the stable repository without a pending request.",
//         tags: [ADMIN_PACKAGES_TAG],
//         responses: APIResponseSpec.describeWithWrongInputs(
//             APIResponseSpec.success("Package copied into stable repository", StableRequestModel.CopyToStable.Response),
//             APIResponseSpec.notFound("Package version not found in archive"),
//             APIResponseSpec.conflict("Package version already exists in stable"),
//             APIResponseSpec.serverError("Failed to copy package into stable repository")
//         )
//     }),

//     zValidator("json", StableRequestModel.CopyToStable.Body),

//     async (c) => {
//         // @ts-ignore
//         const pkg = c.get("package") as DB.Models.Package;
//         // @ts-ignore
//         const authContext = c.get("authContext") as AuthHandler.AuthContext;
//         const { version, arch, leios_patch } = c.req.valid("json") as StableRequestModel.CopyToStable.Body;

//         const alreadyStable = await AptlyAPI.Packages.existsInRepo(
//             "leios-stable",
//             pkg.name,
//             version,
//             leios_patch,
//             arch
//         );

//         if (alreadyStable) {
//             return APIResponse.conflict(c, "Package version already exists in stable repository");
//         }

//         const existsInArchive = await AptlyAPI.Packages.existsInRepo(
//             "leios-archive",
//             pkg.name,
//             version,
//             leios_patch,
//             arch
//         );

//         if (!existsInArchive) {
//             return APIResponse.notFound(c, "Package version not found in archive repository");
//         }

//         try {
//             await AptlyAPI.Packages.copyIntoRepo("leios-stable", pkg.name, version, leios_patch, arch);
//         } catch (error) {
//             return APIResponse.serverError(c, "Failed to copy package into stable repository: " + error);
//         }

//         await DB.instance().update(DB.Schema.stablePromotionRequests).set({
//             status: 'approved',
//             reviewed_by: authContext.user_id,
//             decision_reason: 'Approved by admin while copying to stable'
//         }).where(and(
//             eq(DB.Schema.stablePromotionRequests.package_name, pkg.name),
//             eq(DB.Schema.stablePromotionRequests.version, version),
//             eq(DB.Schema.stablePromotionRequests.architecture, arch),
//             eq(DB.Schema.stablePromotionRequests.status, 'pending')
//         )).run();

//         return APIResponse.success(c, "Package copied into stable repository", {
//             version,
//             arch,
//             leios_patch,
//             copied: true
//         } satisfies StableRequestModel.CopyToStable.Response);
//     }
// );
