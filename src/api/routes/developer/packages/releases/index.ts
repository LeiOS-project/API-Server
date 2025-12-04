import { Hono } from "hono";
import { PackageReleaseModel } from './model'
import { validator as zValidator } from "hono-openapi";
import { APIResponse } from "../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import z from "zod";
import { DB } from "../../../../db";
import { AptlyAPI } from "../../../../../aptly/api";

export const router = new Hono().basePath('/releases');

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List all package releases",
        description: "Retrieve a list of all releases for the specified package.",
        tags: ['Developer API / Packages / Releases'],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Package releases retrieved successfully", PackageReleaseModel.GetAll.Response)
        )
    }),

    async (c) => {
        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;

        const releases = await AptlyAPI.Packages.getAllInAllRepos(packageData.name);

        return APIResponse.success(c, "Package releases retrieved successfully", releases);
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create a new package",
        description: "Create a new package under the authenticated developer's account.",
        tags: ['Developer API / Packages / Releases'],

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



router.use('/:version/*',

    zValidator("param", z.object({
        version: z.string().min(1)
    })),

    async (c, next) => {
        // @ts-ignore
        const { version } = c.req.valid("param");

        // @ts-ignore
        const packageData = c.get("package") as DB.Models.Package;
        const releaseData = await AptlyAPI.Packages.getVersionInRepo("leios-archive", packageData.name, version);
        if (!releaseData) {
            return APIResponse.notFound(c, "Release with specified version not found");
        }
        
        // @ts-ignore
        c.set("release", releaseData);

        await next();
    }
);


router.get('/:packageName',

    APIRouteSpec.authenticated({
        summary: "Get package release details",
        description: "Retrieve details of a specific package release.",
        tags: ['Developer API / Packages / Releases'],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Package release retrieved successfully", PackageReleaseModel.GetReleaseByVersion.Response),
            APIResponseSpec.notFound("Package release with specified version not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const releaseData = c.get("release") as DB.Models.PackageRelease;

        return APIResponse.success(c, "Package release retrieved successfully", releaseData);
    }
);

