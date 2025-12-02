import { Hono } from "hono";
import { PackageModel } from './model'
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../db";
import { eq } from "drizzle-orm";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";

export const router = new Hono().basePath('/packages');

router.get('/',

    APIRouteSpec.unauthenticated({
        summary: "List packages",
        description: "Retrieve a list of available packages.",
        tags: ['Developer API / Packages'],

        responses: APIResponseSpec.describeBasic(
            // APIResponseSpec.success("Packages retrieved successfully", PackageModel.List.Response)
        )
    }),

    async (c) => {

        // const 

        // const packages = DB.instance().select().from(DB.Schema.packages).all();

        // return APIResponse.success(c, "Packages retrieved successfully", packages);
    }
);