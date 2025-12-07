import { Hono } from "hono";
import { PackageModel } from './model'
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../db";
import { eq, and } from "drizzle-orm";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { AuthHandler } from "../../../utils/authHandler";
import { z } from "zod";
import { router as releasesRouter } from "./releases/index";
import { router as stableRequestsRouter } from "./stable-promotion-requests/index";
import { DOCS_TAGS } from "../../../docs";

export const router = new Hono().basePath('/packages');

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List packages",
        description: "Retrieve a list of available packages.",
        tags: [DOCS_TAGS.DEV_API.PACKAGES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Packages retrieved successfully", PackageModel.GetAll.Response)
        )
    }),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        const packages = await DB.instance().select().from(DB.Schema.packages).where(
            eq(DB.Schema.packages.owner_user_id, authContext.user_id)
        );

        return APIResponse.success(c, "Packages retrieved successfully", packages);
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create a new package",
        description: "Create a new package under the authenticated developer's account.",
        tags: [DOCS_TAGS.DEV_API.PACKAGES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.created("Package created successfully", PackageModel.CreatePackage.Response),
            APIResponseSpec.conflict("Package with this name already exists")
        )
    }),

    zValidator("json", PackageModel.CreatePackage.Body),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        const packageData = c.req.valid("json");

        const existingPackage = DB.instance().select().from(DB.Schema.packages).where(eq(DB.Schema.packages.name, packageData.name)).get();
        if (existingPackage) {
            return APIResponse.conflict(c, "Package with this name already exists");
        }

        const result = DB.instance().insert(DB.Schema.packages).values({
            ...packageData,
            owner_user_id: authContext.user_id
        }).returning().get();

        return APIResponse.created(c, "Package created successfully", { id: result.id });
    }
);



router.use('/:packageID/*',

    zValidator("param", z.object({
        packageID: z.int().positive()
    })),

    async (c, next) => {
        // @ts-ignore
        const { packageID } = c.req.valid("param");

        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        const packageData = DB.instance().select().from(DB.Schema.packages).where(and(
            eq(DB.Schema.packages.id, packageID),
            eq(DB.Schema.packages.owner_user_id, authContext.user_id)
        )).get();

        if (!packageData) {
            return APIResponse.notFound(c, "Package with specified ID not found");
        }
        // @ts-ignore
        c.set("package", packageData);

        await next();
    }
);


router.get('/:packageID',

    APIRouteSpec.authenticated({
        summary: "Get package details",
        description: "Retrieve details of a specific package.",
        tags: [DOCS_TAGS.DEV_API.PACKAGES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Package retrieved successfully", PackageModel.GetPackageById.Response),
            APIResponseSpec.notFound("Package with specified ID not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        return APIResponse.success(c, "Package retrieved successfully", packageData);
    }
);

router.put('/:packageID',

    APIRouteSpec.authenticated({
        summary: "Update package details",
        description: "Update details of a specific package owned by the authenticated developer.",
        tags: [DOCS_TAGS.DEV_API.PACKAGES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Package updated successfully"),
            APIResponseSpec.notFound("Package with specified ID not found")
        )
    }),

    zValidator("json", PackageModel.UpdatePackage.Body),

    async (c) => {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        const updateData = c.req.valid("json");

        await DB.instance().update(DB.Schema.packages).set(updateData).where(
            eq(DB.Schema.packages.id, packageData.id)
        );

        return APIResponse.successNoData(c, "Package updated successfully");
    }
);

router.route('/:packageID', releasesRouter);
router.route('/:packageID', stableRequestsRouter);
