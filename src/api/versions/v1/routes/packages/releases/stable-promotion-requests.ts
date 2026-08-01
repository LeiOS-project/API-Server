import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { StablePromotionRequestsModel } from "../../../../../utils/shared-models/stableRequests";
import { AuthHandler } from "../../../../../utils/authHandler";
import { PermissionHelper } from "../../../../../../utils/permission-helper";
import { DOCS_TAGS } from "../../../docs";

export const router = new Hono().basePath('/stable-promotion-requests');


router.get('/',

    APIRouteSpec.unauthenticated({
        summary: "List stable promotion requests for a release",
        description: "Retrieve a list of stable promotion requests for the specified release.",
        operationId: "listReleaseStablePromotionRequests",
        tags: [DOCS_TAGS.PACKAGES_STABLE_REQUESTS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Stable promotion requests retrieved successfully", StablePromotionRequestsModel.GetAll.Response)
        )
    }),

    zValidator("query", StablePromotionRequestsModel.GetAll.Query),

    async (c) => {
        // @ts-ignore
        const release = c.get("release") as DB.Models.PackageRelease;
        const filters = c.req.valid("query");

        let query = DB.instance().select({
            id: DB.Tables.stablePromotionRequests.id,
            package_id: DB.Tables.stablePromotionRequests.package_id,
            package_release_id: DB.Tables.stablePromotionRequests.package_release_id,
            created_at: DB.Tables.stablePromotionRequests.created_at,
            status: DB.Tables.stablePromotionRequests.status,
            admin_note: DB.Tables.stablePromotionRequests.admin_note,

            package_name: DB.Tables.packages.name,
            package_release_version: DB.Tables.packageReleases.version_with_leios_patch,
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
            eq(DB.Tables.stablePromotionRequests.package_release_id, release.id)
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
        summary: "Create a stable promotion request for a release",
        description: "Submit a request for the specified release to be promoted to stable. Requires packages.releases.requestStable permission.",
        operationId: "createReleaseStablePromotionRequest",
        tags: [DOCS_TAGS.PACKAGES_STABLE_REQUESTS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.created("Stable promotion request submitted", StablePromotionRequestsModel.Create.Response),
            APIResponseSpec.forbidden("You do not have permission to request stable promotions for this package"),
            APIResponseSpec.conflict("A request already exists for this release or the release is already stable"),
            APIResponseSpec.badRequest("The release must have at least one uploaded .deb package before requesting stable promotion")
        )
    }),

    zValidator("json", StablePromotionRequestsModel.Create.Body),

    async (c) => {
        // @ts-ignore
        const pkg = c.get("package") as DB.Models.PackageFullView;
        // @ts-ignore
        const release = c.get("release") as DB.Models.PackageRelease;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: pkg.publisher_id,
            packageId: pkg.id,
            check: (p) => p.packages.releases.requestStable
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to request stable promotions for this package");
        }

        const architectures = release.architectures;
        if (!architectures.amd64 && !architectures.arm64 && !architectures.is_all) {
            return APIResponse.badRequest(c, "The release must have at least one uploaded .deb package before requesting stable promotion");
        }

        const alreadyExists = await DB.instance().select({ id: DB.Tables.stablePromotionRequests.id }).from(DB.Tables.stablePromotionRequests).where(
            eq(DB.Tables.stablePromotionRequests.package_release_id, release.id)
        ).get();

        if (alreadyExists) {
            return APIResponse.conflict(c, "A request already exists for this release or the release is already stable");
        }

        const result = await DB.instance().insert(DB.Tables.stablePromotionRequests).values({
            package_id: pkg.id,
            package_release_id: release.id,
            status: "pending"
        }).returning().get();

        return APIResponse.created(c, "Stable promotion request submitted", { id: result.id } satisfies StablePromotionRequestsModel.Create.Response);
    }
);

router.use('/:stablePromotionRequestID',

    zValidator("param", z.object({
        stablePromotionRequestID: z.coerce.number().int().positive()
    })),

    async (c, next) => {
        // @ts-ignore
        const { stablePromotionRequestID } = c.req.valid("param") as { stablePromotionRequestID: number };
        // @ts-ignore
        const release = c.get("release") as DB.Models.PackageRelease;

        const requestData = await DB.instance().select({
            id: DB.Tables.stablePromotionRequests.id,
            package_id: DB.Tables.stablePromotionRequests.package_id,
            package_release_id: DB.Tables.stablePromotionRequests.package_release_id,
            created_at: DB.Tables.stablePromotionRequests.created_at,
            status: DB.Tables.stablePromotionRequests.status,
            admin_note: DB.Tables.stablePromotionRequests.admin_note,

            package_name: DB.Tables.packages.name,
            package_release_version: DB.Tables.packageReleases.version_with_leios_patch,
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
            eq(DB.Tables.stablePromotionRequests.package_release_id, release.id)
        )).get() satisfies StablePromotionRequestsModel.Entity | undefined;

        if (!requestData) {
            return APIResponse.notFound(c, "Stable promotion request not found for this release");
        }

        // @ts-ignore
        c.set("stablePromotionRequest", requestData);

        return await next();
    }
);


router.get('/:stablePromotionRequestID',

    APIRouteSpec.unauthenticated({
        summary: "Get a stable promotion request for a release",
        description: "Retrieve details of a specific stable promotion request for the specified release.",
        operationId: "getReleaseStablePromotionRequest",
        tags: [DOCS_TAGS.PACKAGES_STABLE_REQUESTS],

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
        summary: "Delete a stable promotion request for a release",
        description: "Delete a specific stable promotion request for the specified release. Requires packages.releases.requestStable permission.",
        operationId: "deleteReleaseStablePromotionRequest",
        tags: [DOCS_TAGS.PACKAGES_STABLE_REQUESTS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Stable promotion request deleted successfully"),
            APIResponseSpec.forbidden("You do not have permission to delete stable promotion requests for this package")
        )
    }),

    async (c) => {
        // @ts-ignore
        const pkg = c.get("package") as DB.Models.PackageFullView;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        // @ts-ignore
        const requestData = c.get("stablePromotionRequest") as DB.Models.StablePromotionRequest;

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: pkg.publisher_id,
            packageId: pkg.id,
            check: (p) => p.packages.releases.requestStable
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to delete stable promotion requests for this package");
        }

        await DB.instance().delete(DB.Tables.stablePromotionRequests).where(
            eq(DB.Tables.stablePromotionRequests.id, requestData.id)
        );

        return APIResponse.successNoData(c, "Stable promotion request deleted successfully");
    }
);
