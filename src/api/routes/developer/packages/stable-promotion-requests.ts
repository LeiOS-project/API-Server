import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../db";
import { eq, and } from "drizzle-orm";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { z } from "zod";
import { StablePromotionRequestsModel } from "../../../utils/shared-models/stableRequests";
import { DOCS_TAGS } from "../../../docs";

export const router = new Hono().basePath('/stable-promotion-requests');

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List stable promotion requests for a package",
        description: "Retrieve a list of stable promotion requests for the specified package.",
        tags: [DOCS_TAGS.DEV_API.PACKAGES_STABLE_REQUESTS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Stable promotion requests retrieved successfully", StablePromotionRequestsModel.GetAll.Response)
        )
    }),

    zValidator("query", StablePromotionRequestsModel.GetAll.Query),

    async (c) => {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        const filters = c.req.valid("query");

        let query = DB.instance().select().from(DB.Schema.stablePromotionRequests).where(
            eq(DB.Schema.stablePromotionRequests.package_id, packageData.id)
        ).$dynamic();

        if (filters.status) {
            query = query.where(eq(DB.Schema.stablePromotionRequests.status, filters.status));
        }

        const requests = await query;

        return APIResponse.success(c, "Stable promotion requests retrieved successfully", requests);;
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create a stable promotion request for a package",
        description: "Submit a request for an existing release of the specified package to be promoted to stable.",
        tags: [DOCS_TAGS.DEV_API.PACKAGES_STABLE_REQUESTS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.created("Stable promotion request submitted", StablePromotionRequestsModel.Create.Response),
            APIResponseSpec.notFound("Release not found in archive repository"),
            APIResponseSpec.conflict("A pending request already exists or the release is already stable")
        )
    }),


// router.post('/:packageID/stable-requests',

//     APIRouteSpec.authenticated({
//         summary: "Request promotion to stable",
//         description: "Submit a request for an existing release to be copied into the stable repository.",
//         tags: [DOCS_TAGS.DEV_API.PACKAGES_STABLE_REQUESTS],

//         responses: APIResponseSpec.describeWithWrongInputs(
//             APIResponseSpec.created("Stable promotion request submitted", StableRequestModel.Create.Response),
//             APIResponseSpec.notFound("Release not found in archive repository"),
//             APIResponseSpec.conflict("A pending request already exists or the release is already stable")
//         )
//     }),

//     zValidator("json", StableRequestModel.Create.Body),

//     async (c) => {
//         // @ts-ignore
//         const packageData = c.get("package") as DB.Models.Package;
//         // @ts-ignore
//         const authContext = c.get("authContext") as AuthHandler.AuthContext;

//         const { version, arch, leios_patch } = c.req.valid("json") as StableRequestModel.Create.Body;

//         const existsInArchive = await AptlyAPI.Packages.existsInRepo(
//             "leios-archive",
//             packageData.name,
//             version,
//             leios_patch,
//             arch
//         );

//         if (!existsInArchive) {
//             return APIResponse.notFound(c, "Release not found in archive repository");
//         }

//         const alreadyStable = await AptlyAPI.Packages.existsInRepo(
//             "leios-stable",
//             packageData.name,
//             version,
//             leios_patch,
//             arch
//         );

//         if (alreadyStable) {
//             return APIResponse.conflict(c, "Release already available in stable repository");
//         }

//         const existingPending = DB.instance().select().from(DB.Schema.stablePromotionRequests).where(and(
//             eq(DB.Schema.stablePromotionRequests.package_name, packageData.name),
//             eq(DB.Schema.stablePromotionRequests.version, version),
//             eq(DB.Schema.stablePromotionRequests.architecture, arch),
//             eq(DB.Schema.stablePromotionRequests.status, 'pending')
//         )).get();

//         if (existingPending) {
//             return APIResponse.conflict(c, "A pending request already exists for this version and architecture");
//         }

//         const inserted = DB.instance().insert(DB.Schema.stablePromotionRequests).values({
//             package_name: packageData.name,
//             version,
//             leios_patch,
//             architecture: arch,
//             requested_by: authContext.user_id,
//         }).returning().get();

//         return APIResponse.created(c, "Stable promotion request submitted", { id: inserted.id });
//     }
// );