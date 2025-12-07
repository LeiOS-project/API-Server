import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../db";
import { eq, and } from "drizzle-orm";
import { APIResponse } from "../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { z }from "zod";
import { StablePromotionRequestsModel } from "./model";
import { DOCS_TAGS } from "../../../../docs";

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