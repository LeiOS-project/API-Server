import { Hono } from "hono";
import { PackageReleaseModel } from './model'
import { validator as zValidator } from "hono-openapi";
import { APIResponse } from "../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import z from "zod";
import { DB } from "../../../../../db";
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

router.post('/:version/:arch',

    APIRouteSpec.authenticated({
        summary: "Create a new package release",
        description: "Create a new release for the specified package.",
        tags: ['Developer API / Packages / Releases'],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.created("Package release created successfully", PackageReleaseModel.CreateRelease.Response),
            APIResponseSpec.conflict("Conflict: Package release with this version already exists")
        )
    }),

    zValidator("form", z.file()),

    zValidator("param", z.object({
        version: z.string().min(1),
        arch: z.enum(["amd64", "arm64"])
    })),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        const file = c.req.valid("form");

        const { version, arch } = c.req.valid("param");

        try {
            await AptlyAPI.Packages.uploadAndVerify(
                "leios-archive",
                // @ts-ignore
                (c.get("package") as DB.Models.Package).name,
        }
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

