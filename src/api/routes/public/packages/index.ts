import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import z from "zod";
import { eq } from "drizzle-orm";

import { DB } from "../../../../db";
import { APIResponse } from "../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { AptlyAPI } from "../../../../aptly/api";
import { PackagesModel } from "./model";

const PUBLIC_PACKAGES_TAG = "Public API / Packages";

export const router = new Hono().basePath('/packages');

// List all registered packages (no auth)
router.get('/',

    APIRouteSpec.unauthenticated({
        summary: "List packages",
        description: "Retrieve all packages registered in LeiOS Repo.",
        tags: [PUBLIC_PACKAGES_TAG],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Packages retrieved successfully", PackagesModel.GetAll.Response)
        )
    }),

    async (c) => {
        const packages = await DB.instance().select().from(DB.Schema.packages);
        return APIResponse.success(c, "Packages retrieved successfully", packages);
    }
);

// Package details plus releases across repos
router.get('/:packageName',

    APIRouteSpec.unauthenticated({
        summary: "Get package",
        description: "Retrieve a package and all releases across archive/testing/stable.",
        tags: [PUBLIC_PACKAGES_TAG],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Package retrieved successfully", PackagesModel.PackageDetails.Response),
            APIResponseSpec.notFound("Package not found")
        )
    }),

    zValidator("param", PackagesModel.PackageParams),
    zValidator("query", PackagesModel.RepoQuery),

    async (c) => {
        // @ts-ignore
        const { packageName } = c.req.valid("param") as z.infer<typeof PackagesModel.PackageParams>;
        const { repo } = c.req.valid("query") as z.infer<typeof PackagesModel.RepoQuery>;

        const pkg = DB.instance().select().from(DB.Schema.packages).where(
            eq(DB.Schema.packages.name, packageName)
        ).get();

        if (!pkg) {
            return APIResponse.notFound(c, "Package not found");
        }

        let releases;
        try {
            if (repo) {
                const repoReleases = await AptlyAPI.Packages.getAllInRepo(repo as AptlyAPI.Utils.Repos, pkg.name);
                releases = {
                    "leios-archive": repo === "leios-archive" ? repoReleases : {},
                    "leios-testing": repo === "leios-testing" ? repoReleases : {},
                    "leios-stable": repo === "leios-stable" ? repoReleases : {},
                } satisfies AptlyAPI.Packages.Models.getAllInAllReposResponse;
            } else {
                releases = await AptlyAPI.Packages.getAllInAllRepos(pkg.name);
            }
        } catch (error) {
            return APIResponse.serverError(c, "Failed to fetch package releases: " + error);
        }

        return APIResponse.success(c, "Package retrieved successfully", {
            package: pkg,
            releases
        });
    }
);

// Releases only (useful for lightweight clients)
router.get('/:packageName/releases',

    APIRouteSpec.unauthenticated({
        summary: "List package releases",
        description: "List package releases in archive/testing/stable repositories.",
        tags: [PUBLIC_PACKAGES_TAG],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Package releases retrieved successfully", PackagesModel.PackageReleases.Response),
            APIResponseSpec.notFound("Package not found")
        )
    }),

    zValidator("param", PackagesModel.PackageParams),
    zValidator("query", PackagesModel.RepoQuery),

    async (c) => {
        // @ts-ignore
        const { packageName } = c.req.valid("param") as z.infer<typeof PublicModel.PackageParams>;
        const { repo } = c.req.valid("query") as z.infer<typeof PackagesModel.RepoQuery>;

        const exists = DB.instance().select().from(DB.Schema.packages).where(
            eq(DB.Schema.packages.name, packageName)
        ).get();

        if (!exists) {
            return APIResponse.notFound(c, "Package not found");
        }

        let releases;
        try {
            if (repo) {
                const repoReleases = await AptlyAPI.Packages.getAllInRepo(repo as AptlyAPI.Utils.Repos, packageName);
                releases = {
                    "leios-archive": repo === "leios-archive" ? repoReleases : {},
                    "leios-testing": repo === "leios-testing" ? repoReleases : {},
                    "leios-stable": repo === "leios-stable" ? repoReleases : {},
                } satisfies AptlyAPI.Packages.Models.getAllInAllReposResponse;
            } else {
                releases = await AptlyAPI.Packages.getAllInAllRepos(packageName);
            }
        } catch (error) {
            return APIResponse.serverError(c, "Failed to fetch package releases: " + error);
        }

        return APIResponse.success(c, "Package releases retrieved successfully", releases);
    }
);