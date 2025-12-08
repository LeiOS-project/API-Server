import { Hono } from "hono";
import { PackageReleaseModel } from '../../../../utils/shared-models/pkg-releases'
import { validator as zValidator } from "hono-openapi";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { z } from "zod";
import { PkgReleasesService } from "../../../../utils/services/pkg-releases";

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
        return await PkgReleasesService.getAllReleases(c);
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

    zValidator("query", z.object({
        leios_patch: z.string().optional()
    })),

    async (c) => {
        const file = c.req.valid("form");

        const { version, arch } = c.req.valid("param");
        const { leios_patch } = c.req.valid("query");

        return await PkgReleasesService.createRelease(c, file, version, arch, leios_patch || null, false);
    }
);



router.use('/:releaseID/*',

    zValidator("param", z.object({
        releaseID: z.int().positive()
    })),

    async (c, next) => {
        // @ts-ignore
        const { releaseID } = c.req.valid("param") as { releaseID: number };

        return await PkgReleasesService.pkgReleaseMiddleware(c, next, releaseID);
    }
);


router.get('/:releaseID',

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
        return await PkgReleasesService.getPkgReleaseAfterMiddleware(c);
    }
);

