import z from "zod";
import { AptlyAPI } from "../../../aptly/api";
import { DB } from "../../../db";
import { createSelectSchema } from "drizzle-zod";

export namespace PackageReleaseModel {

    // Matches versions that optionally end with a `leios` patch suffix (e.g. leios1, leios1.1.1)
    // Disallows dangling/invalid leios fragments and limits patch to three numeric segments
    export const versionWithLeiosPatchRegex = /^(?:[0-9][0-9A-Za-z.+~\-]*leios\d+(?:\.\d+){0,2}|(?!.*leios)[0-9][0-9A-Za-z.+~\-]*)$/;

    export const Param = z.object({
        versionWithLeiosPatch: z.string().regex(versionWithLeiosPatchRegex),
        arch: z.enum(["amd64", "arm64"])
    });

}

export namespace PackageReleaseModel.GetReleaseByVersionAndArch {

    export const Response = createSelectSchema(DB.Schema.packageReleases);
    export type Response = z.infer<typeof Response>;

}

export namespace PackageReleaseModel.GetAll {

    export const Response = z.array(PackageReleaseModel.GetReleaseByVersionAndArch.Response);
    export type Response = z.infer<typeof Response>;

}

export namespace PackageReleaseModel.CreateRelease {

    

    // export const Response = z.object({
    //     version: z.string(),
    //     arch: z.enum(["amd64", "arm64"]),
    // });
    // export type Response = z.infer<typeof Response>;

}