import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { AdminStablePromotionRequestModel } from "./model";
import { DB } from "../../../../db";

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
        
        const result = DB.instance().select(DB.Schema.stablePromotionRequests).

    }