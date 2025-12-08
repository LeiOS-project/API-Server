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
        tags: [DOCS_TAGS.ADMIN_API.PACKAGES_STABLE_REQUESTS],

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
        tags: [DOCS_TAGS.ADMIN_API.PACKAGES_STABLE_REQUESTS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.created("Stable promotion request submitted", StablePromotionRequestsModel.Create.Response),
            APIResponseSpec.badRequest("Owner user ID does not correspond to a developer account / Bad Request: Syntax or validation error in request"),
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

        return APIResponse.created(c, "Stable promotion request submitted", { id: result.id } );
    }
)
