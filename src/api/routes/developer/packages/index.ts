import { Hono } from "hono";
import { PackageModel } from '../../../utils/shared-models/package'
import { validator as zValidator } from "hono-openapi";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { z } from "zod";
import { router as releasesRouter } from "./releases";
import { router as stableRequestsRouter } from "./stable-promotion-requests";
import { DOCS_TAGS } from "../../../docs";
import { PackagesService } from "../../../utils/services/packages";

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
        return await PackagesService.getAllPackages(c, false);
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create a new package",
        description: "Create a new package under the authenticated developer's account.",
        tags: [DOCS_TAGS.DEV_API.PACKAGES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.createdNoData("Package created successfully"),
            APIResponseSpec.conflict("Package with this name already exists")
        )
    }),

    zValidator("json", PackageModel.CreatePackage.Body),

    async (c) => {
        const packageData = c.req.valid("json");

        return await PackagesService.createPackage(c, packageData, false);
    }
);



router.use('/:packageName/*',

    zValidator("param", z.object({
        packageName: z.string()
    })),

    async (c, next) => {
        // @ts-ignore
        const { packageName } = c.req.valid("param") as { packageName: string };

        return await PackagesService.packageMiddleware(c, next, packageName, false);
    }
);


router.get('/:packageName',

    APIRouteSpec.authenticated({
        summary: "Get package details",
        description: "Retrieve details of a specific package.",
        tags: [DOCS_TAGS.DEV_API.PACKAGES],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Package retrieved successfully", PackageModel.GetPackageByName.Response),
            APIResponseSpec.notFound("Package with specified Name not found")
        )
    }),

    async (c) => {
        return await PackagesService.getPackageAfterMiddleware(c);
    }
);

router.put('/:packageName',

    APIRouteSpec.authenticated({
        summary: "Update package details",
        description: "Update details of a specific package owned by the authenticated developer.",
        tags: [DOCS_TAGS.DEV_API.PACKAGES],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Package updated successfully"),
            APIResponseSpec.notFound("Package with specified Name not found"),
            APIResponseSpec.forbidden("System-managed packages cannot be updated")
        )
    }),

    zValidator("json", PackageModel.UpdatePackage.Body),

    async (c) => {
        const updateData = c.req.valid("json");

        return await PackagesService.updatePackageAfterMiddleware(c, updateData);
    }
);

router.route('/:packageName', releasesRouter);
router.route('/:packageName', stableRequestsRouter);
