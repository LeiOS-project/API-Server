import z from "zod";
import { PackageModel } from "../../developer/packages/model";
import { AptlyAPI } from "../../../../aptly/api";

export namespace PackagesModel {

    export const PackageParams = z.object({
        packageName: z.string().min(1)
    });
    export type PackageParams = z.infer<typeof PackageParams>;

    export const RepoQuery = z.object({
        repo: z.enum(["leios-archive", "leios-testing", "leios-stable"]).optional()
    });
    export type RepoQuery = z.infer<typeof RepoQuery>;

    export namespace GetAll {
        export const Response = z.array(PackageModel.GetPackageById.Response);
        export type Response = z.infer<typeof Response>;
    }

    export namespace PackageDetails {
        export const Response = z.object({
            package: PackageModel.GetPackageById.Response,
            releases: AptlyAPI.Packages.Models.getAllInAllReposResponse
        });
        export type Response = z.infer<typeof Response>;
    }

    export namespace PackageReleases {
        export const Response = AptlyAPI.Packages.Models.getAllInAllReposResponse;
        export type Response = z.infer<typeof Response>;
    }

}
