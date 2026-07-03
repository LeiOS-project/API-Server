import z from "zod";
import { DB } from "../../../db";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export namespace PackageReleaseModel {

    // Matches versions that optionally end with a `leios` patch suffix (e.g. leios1, leios1.1.1)
    // Disallows dangling/invalid leios fragments and limits patch to three numeric segments
    export const versionWithLeiOSPatchRegex = /^(?:[0-9][0-9A-Za-z.+~\-]*leios\d+(?:\.\d+){0,2}|(?!.*leios)[0-9][0-9A-Za-z.+~\-]*)$/;
    export const versionWithRequiredLeiOSPatchRegex = /^(?:[0-9][0-9A-Za-z.+~\-]*leios\d+(?:\.\d+){0,2})$/;

    export const Param = z.object({
        version_with_leios_patch: z.string().regex(versionWithLeiOSPatchRegex)
    });

    export const PostParamWithArch = z.object({
        arch: z.enum(["amd64", "arm64", "all"])
    });

}

export namespace PackageReleaseModel.GetReleaseByVersion {

    export const Response = createSelectSchema(DB.Tables.packageReleases, {
        architectures: z.object({
            amd64: z.boolean(),
            arm64: z.boolean(),
            is_all: z.boolean()
        })
    }).omit({
        package_id: true
    });
    export type Response = z.infer<typeof Response>;

}

export namespace PackageReleaseModel.GetAll {

    export const Response = z.array(PackageReleaseModel.GetReleaseByVersion.Response);
    export type Response = z.infer<typeof Response>;

}

export namespace PackageReleaseModel.CreateRelease {

    export const Body = createInsertSchema(DB.Tables.packageReleases, {
        version_with_leios_patch: z.string().regex(versionWithLeiOSPatchRegex),
        changelog: z.string().min(1, "Changelog cannot be empty").max(10000, "Changelog cannot exceed 10,000 characters")
    }).omit({
        id: true,
        package_id: true,
        created_at: true,
        architectures: true
    });

    export type Body = z.infer<typeof Body>;

}

export namespace PackageReleaseModel.UpdateRelease {

    export const Body = PackageReleaseModel.CreateRelease.Body.partial().omit({
        version_with_leios_patch: true
    });

    export type Body = z.infer<typeof Body>;

}

export namespace PackageReleaseModel.UploadReleaseAssetForArch {

    export const FileInput = z.object({
        file: z.file().min(1).max(1024 * 1024 * 1024), // Max 1 GB
    });


}
