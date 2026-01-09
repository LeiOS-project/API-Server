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

router.post('/:versionWithLeiosPatch',

    APIRouteSpec.authenticated({
        summary: "Create a new package release",
        description: "Create a new release for the specified package.",
        tags: [DOCS_TAGS.ADMIN_API.PACKAGES_RELEASES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.createdNoData("Package release created successfully"),
            APIResponseSpec.conflict("Package release with this version already exists"),
            APIResponseSpec.badRequest("Package requires leios patch suffix in version but is missing in version argument / Syntax or validation error in request")
        )
    }),

    zValidator("param", PackageReleaseModel.Param),

    async (c) => {
        const { versionWithLeiosPatch } = c.req.valid("param");

        return await PkgReleasesService.createRelease(c, versionWithLeiosPatch);
    }
)


router.use('/:versionWithLeiosPatch/*',

    zValidator("param", PackageReleaseModel.Param),

    async (c, next) => {
        // @ts-ignore
        const { versionWithLeiosPatch } = c.req.valid("param") as { versionWithLeiosPatch: string};

        return await PkgReleasesService.pkgReleaseMiddleware(c, next, versionWithLeiosPatch);
    }
);


router.get('/:versionWithLeiosPatch',

    APIRouteSpec.authenticated({
        summary: "Get package release details",
        description: "Retrieve details of a specific package release.",
        tags: [DOCS_TAGS.ADMIN_API.PACKAGES_RELEASES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Package release retrieved successfully", PackageReleaseModel.GetReleaseByVersion.Response),
            APIResponseSpec.notFound("Package release with specified version not found")
        )
    }),

    async (c) => {
        return await PkgReleasesService.getPkgReleaseAfterMiddleware(c);
    }
);

router.post('/:versionWithLeiosPatch/:arch',

    APIRouteSpec.authenticated({
        summary: "Upload package release file for architecture and release into testing repository",
        description: "Upload a release file for the specified package and architecture.",
        tags: [DOCS_TAGS.ADMIN_API.PACKAGES_RELEASES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.createdNoData("Package release file uploaded successfully"),
            APIResponseSpec.conflict("Package release already contains a release for this architecture"),
            APIResponseSpec.serverError("Failed to upload and verify package release asset")
        )
    }),

    zValidator("form", PackageReleaseModel.UploadReleaseAssetForArch.FileInput),

    zValidator("param", PackageReleaseModel.ParamWithArch),

    async (c) => {
        const { file } = c.req.valid("form");

        const { arch } = c.req.valid("param");

        return await PkgReleasesService.uploadReleaseAssetAfterMiddleware(c, file, arch, true);
    }
);

router.delete('/:versionWithLeiosPatch',

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
