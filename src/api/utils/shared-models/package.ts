import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { DB } from "../../../db";
import z from "zod";

export namespace PackageModel {

    export const ForbiddenPackageNames = [
        "admin",
        "user",
        "users",
        "package",
        "packages",
        "release",
        "releases",
        "os",
        "api",
        "dashboard",
        "home",
        "settings",
        "login",
        "logout",
        "register",
        "auth",
        "static",
        "public",
        "new",
        "edit",
        "delete",
        "update",
        "create",
        "list",
        "all",
        "latest",
        "stable",
        "testing",
        "beta",
        "alpha",
        "dev",
        "development",
        "prod",
        "production",

        // Forbiddden LeiCraft_MC related names
        "leicraft",
        "leios"
    ] as const;
    
}

export namespace PackageModel.GetPackageByName {
    
    export const Response = createSelectSchema(DB.Schema.packages);
    export type Response = z.infer<typeof Response>;

}

export namespace PackageModel.GetAll {

    export const Response = z.array(PackageModel.GetPackageByName.Response);
    export type Response = z.infer<typeof Response>;

}

export namespace PackageModel.CreatePackageAsAdmin {

    export const Body = createInsertSchema(DB.Schema.packages, {
        name: z.string()
            .min(2, "Package names must be at least 2 characters long.")
            .max(63, "Package names cannot exceed 63 characters.")
            /*.regex(
                /^[a-z0-9][a-z0-9+.-]{1,62}$/,
                "Package names must be 2-63 chars, lowercase, and may contain + - ."
            )*/
            /* .regex(
                /^[a-z0-9].*[a-z0-9]$/,
                "Package names must start and end with a letter or number."
            )*/
            .regex(/^[a-z0-9][a-z0-9+.-]*[a-z0-9]$/, "Package names must be lowercase, may contain + - ., and start/end with a letter or number.")
            .refine((name) => !PackageModel.ForbiddenPackageNames.includes(name as any), {
                message: "This package name is reserved and cannot be used."
            })
    }).omit({
        id: true,
        created_at: true,
        latest_stable_release_amd64: true,
        latest_stable_release_arm64: true,
        latest_testing_release_amd64: true,
        latest_testing_release_arm64: true
    });

    export type Body = z.infer<typeof Body>;

}

export namespace PackageModel.CreatePackage {

    export const Body = PackageModel.CreatePackageAsAdmin.Body.omit({
        owner_user_id: true
    });

    export type Body = z.infer<typeof Body>;
}

export namespace PackageModel.UpdatePackage {

    export const Body = PackageModel.CreatePackage.Body.omit({
        name: true
    }).partial().refine(
        (data) => Object.values(data).some((value) => value !== undefined),
        { message: "At least one field must be provided" }
    );

    export type Body = z.infer<typeof Body>;

}