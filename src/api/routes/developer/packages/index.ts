import { Hono } from "hono";
import { PackageModel } from './model'
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../db";
import { eq, and } from "drizzle-orm";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { AuthHandler } from "../../../utils/authHandler";
import z from "zod";
import { AptlyAPI } from "../../../../aptly/api";
import { router as releasesRouter } from "./releases/index";

export const router = new Hono().basePath('/packages');

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List packages",
        description: "Retrieve a list of available packages.",
        tags: ['Developer API / Packages'],

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
        tags: ['Developer API / Packages'],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.created("Package created successfully", PackageModel.CreatePackage.Response),
            APIResponseSpec.conflict("Conflict: Package with this name already exists")
        )
    }),

    zValidator("json", PackageModel.CreatePackage.Body),

    async (c) => {
        // @ts-ignore
        const session = c.get("session") as DB.Models.Session;

        const packageData = c.req.valid("json");

        const existingPackage = DB.instance().select().from(DB.Schema.packages).where(eq(DB.Schema.packages.name, packageData.name)).get();
        if (existingPackage) {
            return APIResponse.conflict(c, "Package with this name already exists");
        }

        const result = DB.instance().insert(DB.Schema.packages).values({
            ...packageData,
            owner_user_id: session.user_id
        }).returning().get();

        return APIResponse.created(c, "Package created successfully", { name: result.name });
    }
);



router.use('/:packageName/*',

    zValidator("param", z.object({
        packageName: z.string().min(1)
    })),

    async (c, next) => {
        // @ts-ignore
        const { packageName } = c.req.valid("param");

        // @ts-ignore
        const session = c.get("session") as DB.Models.Session;

        const packageData = DB.instance().select().from(DB.Schema.packages).where(and(
            eq(DB.Schema.packages.name, packageName),
            eq(DB.Schema.packages.owner_user_id, session.user_id)
        )).get();

        if (!packageData) {
            return APIResponse.notFound(c, "Package with specified name not found");
        }
        // @ts-ignore
        c.set("package", packageData);

        await next();
    }
);


router.get('/:packageName',

    APIRouteSpec.authenticated({
        summary: "Get package details",
        description: "Retrieve details of a specific package.",
        tags: ['Developer API / Packages'],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Package retrieved successfully", PackageModel.GetPackageById.Response),
            APIResponseSpec.notFound("Package with specified name not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        return APIResponse.success(c, "Package retrieved successfully", packageData);
    }
);

router.put('/:packageName',

    APIRouteSpec.authenticated({
        summary: "Update package details",
        description: "Update details of a specific package owned by the authenticated developer.",
        tags: ['Developer API / Packages'],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Package updated successfully"),
            APIResponseSpec.notFound("Package with specified name not found")
        )
    }),

    zValidator("json", PackageModel.UpdatePackage.Body),

    async (c) => {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        const updateData = c.req.valid("json");

        await DB.instance().update(DB.Schema.packages).set(updateData).where(
            eq(DB.Schema.packages.name, packageData.name)
        );

        return APIResponse.successNoData(c, "Package updated successfully");
    }
);

// Only admins can delete packages for now
// router.delete('/:packageName',

//     APIRouteSpec.authenticated({
//         summary: "Delete a package",
//         description: "Delete a specific package owned by the authenticated developer.",
//         tags: ['Developer API / Packages'],

//         responses: APIResponseSpec.describeBasic(
//             APIResponseSpec.successNoData("Package deleted successfully"),
//             APIResponseSpec.notFound("Package with specified name not found")
//         )
//     }),

//     async (c) => {
//         // @ts-ignore
//         const packageData = c.get("package") as DB.Models.Package;

//         await AptlyAPI.Packages.deleteAllInAllRepos(packageData.name);

//         await DB.instance().delete(DB.Schema.packages).where(
//             eq(DB.Schema.packages.name, packageData.name)
//         );

//         return APIResponse.successNoData(c, "Package deleted successfully");
//     }
// );

router.route('/:packageName', releasesRouter);