import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { AdminStablePromotionRequestModel } from "./model";
import { DB } from "../../../../db";
import { APIResponse } from "../../../utils/api-res";
import { eq } from "drizzle-orm";

export const router = new Hono().basePath('/stable-promotion-requests');

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List stable promotion requests",
        description: "Retrieve a list of all stable promotion requests for packages.",
        tags: [DOCS_TAGS.ADMIN_API.STABLE_PROMOTION_REQUESTS],
        
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Stable promotion requests retrieved successfully", AdminStablePromotionRequestModel.GetAll.Response)
        )
    }),

    async (c) => {
        
        const result = await DB.instance().select().from(DB.Schema.stablePromotionRequests);

        return APIResponse.success(c, "Stable promotion requests retrieved successfully", result);

    }
);

router.use('/:requestID/*',

    zValidator("param", z.object({
        requestID: z.coerce.number().int().positive()
    })),

    async (c, next) => {
        // @ts-ignore
        const requestID = c.get("requestID") as number;

        const request = DB.instance().select().from(DB.Schema.stablePromotionRequests).where(
            eq(DB.Schema.stablePromotionRequests.id, requestID)
        ).get();

        if (!request) {
            return APIResponse.notFound(c, "Stable promotion request not found");
        }

        // @ts-ignore
        c.set("stablePromotionRequest", request);

        await next();
    }
);

router.get('/:requestID',

    APIRouteSpec.authenticated({
        summary: "Get stable promotion request details",
        description: "Retrieve details of a specific stable promotion request.",
        tags: [DOCS_TAGS.ADMIN_API.STABLE_PROMOTION_REQUESTS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Stable promotion request retrieved successfully", AdminStablePromotionRequestModel.GetById.Response),
            APIResponseSpec.notFound("Stable promotion request not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const request = c.get("stablePromotionRequest") as DB.Models.StablePromotionRequest;

        return APIResponse.success(c, "Stable promotion request retrieved successfully", request);
    }
);

router.post('/:requestID/approve',

    APIRouteSpec.authenticated({
        summary: "Approve stable promotion request",
        description: "Approve a specific stable promotion request, promoting the package release to stable.",
        tags: [DOCS_TAGS.ADMIN_API.STABLE_PROMOTION_REQUESTS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Stable promotion request approved successfully"),
            APIResponseSpec.notFound("Stable promotion request not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const request = c.get("stablePromotionRequest") as DB.Models.StablePromotionRequest;
    }
);