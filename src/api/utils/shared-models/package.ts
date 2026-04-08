import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { DB } from "../../../db";
import z from "zod";

export namespace PackageModel {

    /**
     * Package naming convention:
     * - publisher.pkgname (for publisher-level packages)
     * - publisher.group.pkgname (for group packages)
     * - publisher.subgroup1.subgroup2.pkgname (for nested groups)
     * 
     * Validation rules:
     * - Must follow the hierarchical pattern
     * - Each component must be lowercase alphanumeric with hyphens
     * - Package short name cannot be a forbidden name
     */
    export const PackageNameSchema = z.string()
        .min(3, "Package names must be at least 3 characters long.")
        .max(200, "Package names cannot exceed 200 characters.")
        .regex(
            /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/,
            "Package name must follow pattern: pkgname or group.pkgname"
        );


    export const PackageFlags = z.array(z.enum([

        // Indicates that the package is fully managed by the system and cannot be modified or deleted by anyone including admins
        "SYSTEM-MANAGED",

        // Add more flags as needed
    ])).refine((flags) => {
        // Ensure no duplicate flags
        return new Set(flags).size === flags.length;
    }, { message: "Duplicate flags are not allowed." });

    export type PackageFlags = z.infer<typeof PackageFlags>;
    
}

export namespace PackageModel.GetPackageByFullName {
    
    export const Response = createSelectSchema(DB.Tables.packagesFullView, {

        fullname: z.string(),

        latest_stable_release: z.object({
            amd64: z.string().nullable(),
            arm64: z.string().nullable(),
        }),
        latest_testing_release: z.object({
            amd64: z.string().nullable(),
            arm64: z.string().nullable(),
        })

    }).extend({
        // somehow zod didn't infer the type of fullname correctly, so we need to add it manually
        fullname: z.string()
    });

    export type Response = z.infer<typeof Response>;

}

export namespace PackageModel.GetAll {

    export const Response = z.array(PackageModel.GetPackageByFullName.Response);
    export type Response = z.infer<typeof Response>;

}

export namespace PackageModel.CreatePackage {

    export const Body = createInsertSchema(DB.Tables.packages, {
        name: PackageModel.PackageNameSchema,
        description: z.string().min(1, "Description is required").max(500, "Description cannot exceed 500 characters."),
        homepage_url: z.url("Homepage URL must be a valid URL."),
        requires_patching: z.boolean().default(false),
    }).omit({
        id: true,
        created_at: true,
        flags: true,
        topLevelAlias: true,
        latest_stable_release: true,
        latest_testing_release: true
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