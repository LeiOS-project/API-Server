import z from "zod";
import { AptlyAPI } from "../../../../../aptly/api";

export namespace PackageReleaseModel.GetReleaseByVersion {

    export const Response = AptlyAPI.Packages.Models.getVersionInRepoResponse;
    export type Response = z.infer<typeof Response>;

}

export namespace PackageReleaseModel.GetAll {

    export const Response = AptlyAPI.Packages.Models.getAllInAllReposResponse;
    export type Response = z.infer<typeof Response>;

}

export namespace PackageReleaseModel.CreateRelease {

    export const Response = z.object({
        version: z.string(),
        arch: z.enum(["amd64", "arm64"]),
    });
    export type Response = z.infer<typeof Response>;

}