import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { AdminStablePromotionRequestModel } from "./model";
import { DB } from "../../../../db";
import { APIResponse } from "../../../utils/api-res";
import { asc, desc, eq } from "drizzle-orm";
import { RuntimeMetadata } from "../../../utils/metadata";
import { ApiHelperModels } from "../../../utils/shared-models/api-helper-models";

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

    zValidator("query", ApiHelperModels.ListAll.Query),

    async (c) => {

        const { limit, offset, order } = c.req.valid("query");
        
        const results = await DB.instance().select({
            id: DB.Schema.stablePromotionRequests.id,
            package_id: DB.Schema.stablePromotionRequests.package_id,
            package_release_id: DB.Schema.stablePromotionRequests.package_release_id,
            created_at: DB.Schema.stablePromotionRequests.created_at,
            status: DB.Schema.stablePromotionRequests.status,
            admin_note: DB.Schema.stablePromotionRequests.admin_note,

            package_name: DB.Schema.packages.name,
            package_release_version: DB.Schema.packageReleases.versionWithLeiosPatch,
        })
        .from(DB.Schema.stablePromotionRequests)
        .innerJoin(
            DB.Schema.packages,
            eq(DB.Schema.packages.id, DB.Schema.stablePromotionRequests.package_id),
        )
        .innerJoin(
            DB.Schema.packageReleases,
            eq(DB.Schema.packageReleases.id, DB.Schema.stablePromotionRequests.package_release_id),
        )
        .orderBy(
            order === "newest" ?
                desc(DB.Schema.stablePromotionRequests.created_at) :
                asc(DB.Schema.stablePromotionRequests.created_at)
        )
        .limit(limit)
        .offset(offset);

        return APIResponse.success(c, "Stable promotion requests retrieved successfully", results satisfies AdminStablePromotionRequestModel.GetAll.Response);
    }
);

router.use('/:stablePromotionRequestID/*',

    zValidator("param", z.object({
        stablePromotionRequestID: z.coerce.number().int().positive()
    })),

    async (c, next) => {
        // @ts-ignore
        const { stablePromotionRequestID } = c.req.valid("param") as { stablePromotionRequestID: number };

        const request = DB.instance().select().from(DB.Schema.stablePromotionRequests).where(
            eq(DB.Schema.stablePromotionRequests.id, stablePromotionRequestID)
        ).get();

        if (!request) {
            return APIResponse.notFound(c, "Stable promotion request not found");
        }

        // @ts-ignore
        c.set("stablePromotionRequest", request);

        await next();
    }
);

router.get('/:stablePromotionRequestID',

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

        const pkg = DB.instance().select({
            name: DB.Schema.packages.name
        }).from(DB.Schema.packages).where(
            eq(DB.Schema.packages.id, request.package_id)
        ).get();

        if (!pkg) {
            throw new Error(`Package with ID ${request.package_id} not found for stable promotion request ID ${request.id}`);
        }
        const pkgRelease = DB.instance().select({
            versionWithLeiosPatch: DB.Schema.packageReleases.versionWithLeiosPatch
        }).from(DB.Schema.packageReleases).where(
            eq(DB.Schema.packageReleases.id, request.package_release_id)
        ).get();

        if (!pkgRelease) {
            throw new Error(`Package release with ID ${request.package_release_id} not found for stable promotion request ID ${request.id}`);
        }

        const result = {
            ...request,
            package_name: pkg.name,
            package_release_version: pkgRelease.versionWithLeiosPatch
        };

        return APIResponse.success(c, "Stable promotion request retrieved successfully", result satisfies AdminStablePromotionRequestModel.GetById.Response);
    }
);

router.post('/:stablePromotionRequestID/decide',

    APIRouteSpec.authenticated({
        summary: "Decide on a stable promotion request",
        description: "Approve or reject a stable promotion request for a package.",
        tags: [DOCS_TAGS.ADMIN_API.STABLE_PROMOTION_REQUESTS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Decided on stable promotion request successfully"),
            APIResponseSpec.badRequest("Stable promotion request has already been approved or denied / Invalid input data"),
            APIResponseSpec.notFound("Stable promotion request not found")
        )
    }),

    zValidator("json", AdminStablePromotionRequestModel.Decide.Body),

    async (c) => {
        // @ts-ignore
        const request = c.get("stablePromotionRequest") as DB.Models.StablePromotionRequest;

        const decision = c.req.valid("json");

        if (request.status !== 'pending') {
            return APIResponse.badRequest(c, "Stable promotion request has already been approved or denied");
        }

        await DB.instance().update(DB.Schema.stablePromotionRequests).set({
            status: decision.status,
            admin_note: decision.admin_note
        }).where(
            eq(DB.Schema.stablePromotionRequests.id, request.id)
        );

        if (decision.status === 'approved') {
            await RuntimeMetadata.addOSReleasePendingPackage(request.package_release_id);
        }

        return APIResponse.successNoData(c, "Stable promotion request approved successfully");
    }
);