import type { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../db";
import { eq, and } from "drizzle-orm";
import { APIResponse } from "../api-res";
import { APIResponseSpec, APIRouteSpec } from "../specHelpers";
import { z } from "zod";
import { StablePromotionRequestsModel } from "../shared-models/stableRequests";
import { DOCS_TAGS } from "../../docs";

export async function setupPackageStablePromotionRequestRoutes(router: Hono, admin: boolean) {

    const tags = admin ? [DOCS_TAGS.ADMIN_API.PACKAGES_STABLE_REQUESTS] : [DOCS_TAGS.DEV_API.PACKAGES_STABLE_REQUESTS];

    
    router.get('/',

        APIRouteSpec.authenticated({
            summary: "List stable promotion requests for a package",
            description: "Retrieve a list of stable promotion requests for the specified package.",
            tags,

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

            return APIResponse.success(c, "Stable promotion requests retrieved successfully", requests satisfies StablePromotionRequestsModel.Entity[]);
        }
    );

    router.post('/',

        APIRouteSpec.authenticated({
            summary: "Create a stable promotion request for a package",
            description: "Submit a request for an existing release of the specified package to be promoted to stable.",
            tags,

            responses: APIResponseSpec.describeWithWrongInputs(
                APIResponseSpec.created("Stable promotion request submitted", StablePromotionRequestsModel.Create.Response),
                APIResponseSpec.notFound("Release not found in archive repository"),
                APIResponseSpec.conflict("A request already for this release already exists or the release is already stable")
            )
        }),

        zValidator("json", StablePromotionRequestsModel.Create.Body),
        
        async (c) => {
            const requestData = c.req.valid("json");

            // @ts-ignore
            const packageData = c.get("package") as DB.Models.Package;

            const releaseExists = DB.instance().select().from(DB.Schema.packageReleases).where(and(
                eq(DB.Schema.packageReleases.id, requestData.package_release_id),
                eq(DB.Schema.packageReleases.package_id, packageData.id)
            )).get();

            if (!releaseExists) {
                return APIResponse.notFound(c, "Release not found in archive repository");
            }

            const alreadyExists = DB.instance().select().from(DB.Schema.stablePromotionRequests).where(
                eq(DB.Schema.stablePromotionRequests.package_release_id, requestData.package_release_id)
            ).get();

            if (alreadyExists) {
                return APIResponse.conflict(c, "A request already for this release already exists or the release is already stable");
            }

            const result = await DB.instance().insert(DB.Schema.stablePromotionRequests).values({
                package_id: packageData.id,
                package_release_id: requestData.package_release_id,
                status: "pending"
            }).returning().get();

            return APIResponse.created(c, "Stable promotion request submitted", { id: result.id } satisfies StablePromotionRequestsModel.Create.Response );
        }
    )

    router.use('/:requestID',
        
        zValidator("param", z.object({
            requestID: z.coerce.number().int().positive()
        })),

        async (c, next) => {

            // @ts-ignore
            const { requestID } = c.req.valid("param") as { requestID: number };

            // @ts-ignore
            const packageData = c.get("package") as DB.Models.Package;

            const requestData = await DB.instance().select().from(DB.Schema.stablePromotionRequests).where(and(
                eq(DB.Schema.stablePromotionRequests.id, requestID),
                eq(DB.Schema.stablePromotionRequests.package_id, packageData.id)
            )).get();

            if (!requestData) {
                return APIResponse.notFound(c, "Stable promotion request not found for this package");
            }

            // @ts-ignore
            c.set("stablePromotionRequest", requestData as DB.Models.StablePromotionRequest);

            await next();
        }
    );


    router.get('/:requestID',

        APIRouteSpec.authenticated({
            summary: "Get a stable promotion request for a package",
            description: "Retrieve details of a specific stable promotion request for the specified package.",
            tags,

            responses: APIResponseSpec.describeBasic(
                APIResponseSpec.success("Stable promotion request retrieved successfully", StablePromotionRequestsModel.GetByID.Response)
            )
        }),

        async (c) => {
            // @ts-ignore
            const requestData = c.get("stablePromotionRequest") as StablePromotionRequestsModel.GetByID.Response;

            return APIResponse.success(c, "Stable promotion request retrieved successfully", requestData satisfies StablePromotionRequestsModel.GetByID.Response);
        }
    );

    router.delete('/:requestID',

        APIRouteSpec.authenticated({
            summary: "Delete a stable promotion request for a package",
            description: "Delete a specific stable promotion request for the specified package.",
            tags,

            responses: APIResponseSpec.describeBasic(
                APIResponseSpec.success("Stable promotion request deleted successfully", z.object({}))
            )
        }),

        async (c) => {
            // @ts-ignore
            const requestData = c.get("stablePromotionRequest") as DB.Models.StablePromotionRequest;

            await DB.instance().delete(DB.Schema.stablePromotionRequests).where(
                eq(DB.Schema.stablePromotionRequests.id, requestData.id)
            );

            return APIResponse.success(c, "Stable promotion request deleted successfully", {});
        }
    );

}
