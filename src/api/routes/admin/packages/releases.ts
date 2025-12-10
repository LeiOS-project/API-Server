import { Hono } from "hono";
import { PackageReleaseModel } from '../../../utils/shared-models/pkg-releases'
import { validator as zValidator } from "hono-openapi";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { z } from "zod";
import { PkgReleasesService } from "../../../utils/services/pkg-releases";
import { DOCS_TAGS } from "../../../docs";

export const router = new Hono().basePath('/releases');

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List all package releases",
        description: "Retrieve a list of all releases for the specified package.",
        tags: [DOCS_TAGS.ADMIN_API.PACKAGES_RELEASES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Package releases retrieved successfully", PackageReleaseModel.GetAll.Response)
        )
    }),

    async (c) => {
        return await PkgReleasesService.getAllReleases(c);
    }
);

router.post('/:versionWithLeiosPatch/:arch',

    APIRouteSpec.authenticated({
        summary: "Create a new package release",
        description: "Create a new release for the specified package.",
        tags: [DOCS_TAGS.ADMIN_API.PACKAGES_RELEASES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.createdNoData("Package release created successfully"),
            APIResponseSpec.conflict("Conflict: Package release with this version already exists")
        )
    }),

    zValidator("form", z.object({
        file: z.file()
    })),

    zValidator("param", PackageReleaseModel.Param),

    async (c) => {
        const { file } = c.req.valid("form");

        const { versionWithLeiosPatch, arch } = c.req.valid("param");

        return await PkgReleasesService.createRelease(c, file, versionWithLeiosPatch, arch, false);
    }
);



router.use('/:versionWithLeiosPatch/:arch/*',

    zValidator("param", PackageReleaseModel.Param),

    async (c, next) => {
        // @ts-ignore
        const { versionWithLeiosPatch, arch } = c.req.valid("param") as { versionWithLeiosPatch: string, arch: "amd64" | "arm64" };

        return await PkgReleasesService.pkgReleaseMiddleware(c, next, versionWithLeiosPatch, arch);
    }
);


router.get('/:versionWithLeiosPatch/:arch',

    APIRouteSpec.authenticated({
        summary: "Get package release details",
        description: "Retrieve details of a specific package release.",
        tags: [DOCS_TAGS.ADMIN_API.PACKAGES_RELEASES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Package release retrieved successfully", PackageReleaseModel.GetReleaseByVersionAndArch.Response),
            APIResponseSpec.notFound("Package release with specified version not found")
        )
    }),

    async (c) => {
        return await PkgReleasesService.getPkgReleaseAfterMiddleware(c);
    }
);

router.delete('/:versionWithLeiosPatch/:arch',

    APIRouteSpec.authenticated({
        summary: "Delete a package release",
        description: "Delete a specific package release.",
        tags: [DOCS_TAGS.ADMIN_API.PACKAGES_RELEASES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Package release deleted successfully"),
            APIResponseSpec.notFound("Package release with specified ID not found")
        )
    }),

    async (c) => {
        return await PkgReleasesService.deletePkgReleaseAfterMiddlewareAsAdmin(c);
    }
);
