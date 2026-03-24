import type { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../db";
import { eq, and } from "drizzle-orm";
import { APIResponse } from "../api-res";
import { APIResponseSpec, APIRouteSpec } from "../specHelpers";
import { z } from "zod";
import { StablePromotionRequestsModel } from "../shared-models/stableRequests";
import { DOCS_TAGS } from "../../versions/v1/docs";

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

            let query = DB.instance().select({
                id: DB.Tables.stablePromotionRequests.id,
                package_id: DB.Tables.stablePromotionRequests.package_id,
                package_release_id: DB.Tables.stablePromotionRequests.package_release_id,
                created_at: DB.Tables.stablePromotionRequests.created_at,
                status: DB.Tables.stablePromotionRequests.status,
                admin_note: DB.Tables.stablePromotionRequests.admin_note,

                package_name: DB.Tables.packages.name,
                package_release_version: DB.Tables.packageReleases.versionWithLeiosPatch,
            })
            .from(DB.Tables.stablePromotionRequests)
            .innerJoin(
                DB.Tables.packages,
                eq(DB.Tables.packages.id, DB.Tables.stablePromotionRequests.package_id),
            )
            .innerJoin(
                DB.Tables.packageReleases,
                eq(DB.Tables.packageReleases.id, DB.Tables.stablePromotionRequests.package_release_id),
            )
            .where(
                eq(DB.Tables.stablePromotionRequests.package_id, packageData.id)
            ).$dynamic();

            if (filters.status) {
                query = query.where(eq(DB.Tables.stablePromotionRequests.status, filters.status));
            }

            const requests = (await query satisfies StablePromotionRequestsModel.Entity[]) as StablePromotionRequestsModel.GetAll.Response;

            return APIResponse.success(c, "Stable promotion requests retrieved successfully", requests satisfies StablePromotionRequestsModel.GetAll.Response);
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

            const releaseExists = DB.instance().select().from(DB.Tables.packageReleases).where(and(
                eq(DB.Tables.packageReleases.id, requestData.package_release_id),
                eq(DB.Tables.packageReleases.package_id, packageData.id)
            )).get();

            if (!releaseExists) {
                return APIResponse.notFound(c, "Release not found in archive repository");
            }

            const alreadyExists = DB.instance().select().from(DB.Tables.stablePromotionRequests).where(
                eq(DB.Tables.stablePromotionRequests.package_release_id, requestData.package_release_id)
            ).get();

            if (alreadyExists) {
                return APIResponse.conflict(c, "A request already for this release already exists or the release is already stable");
            }

            const result = await DB.instance().insert(DB.Tables.stablePromotionRequests).values({
                package_id: packageData.id,
                package_release_id: requestData.package_release_id,
                status: "pending"
            }).returning().get();

            return APIResponse.created(c, "Stable promotion request submitted", { id: result.id } satisfies StablePromotionRequestsModel.Create.Response );
        }
    )

    router.use('/:stablePromotionRequestID',
        
        zValidator("param", z.object({
            stablePromotionRequestID: z.coerce.number().int().positive()
        })),

        async (c, next) => {

            // @ts-ignore
            const { stablePromotionRequestID } = c.req.valid("param") as { stablePromotionRequestID: number };

            // @ts-ignore
            const packageData = c.get("package") as DB.Models.Package;

            const requestData = await DB.instance().select({
                id: DB.Tables.stablePromotionRequests.id,
                package_id: DB.Tables.stablePromotionRequests.package_id,
                package_release_id: DB.Tables.stablePromotionRequests.package_release_id,
                created_at: DB.Tables.stablePromotionRequests.created_at,
                status: DB.Tables.stablePromotionRequests.status,
                admin_note: DB.Tables.stablePromotionRequests.admin_note,

                package_name: DB.Tables.packages.name,
                package_release_version: DB.Tables.packageReleases.versionWithLeiosPatch,
            })
            .from(DB.Tables.stablePromotionRequests)
            .innerJoin(
                DB.Tables.packages,
                eq(DB.Tables.packages.id, DB.Tables.stablePromotionRequests.package_id),
            )
            .innerJoin(
                DB.Tables.packageReleases,
                eq(DB.Tables.packageReleases.id, DB.Tables.stablePromotionRequests.package_release_id),
            )
            .where(and(
                eq(DB.Tables.stablePromotionRequests.id, stablePromotionRequestID),
                eq(DB.Tables.stablePromotionRequests.package_id, packageData.id)
            )).get() satisfies StablePromotionRequestsModel.Entity | undefined;

            if (!requestData) {
                return APIResponse.notFound(c, "Stable promotion request not found for this package");
            }

            // @ts-ignore
            c.set("stablePromotionRequest", requestData);

            await next();
        }
    );


    router.get('/:stablePromotionRequestID',

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

    router.delete('/:stablePromotionRequestID',

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

            await DB.instance().delete(DB.Tables.stablePromotionRequests).where(
                eq(DB.Tables.stablePromotionRequests.id, requestData.id)
            );

            return APIResponse.success(c, "Stable promotion request deleted successfully", {});
        }
    );

}
