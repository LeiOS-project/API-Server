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

