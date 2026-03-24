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

        // Forbidden LeiCraft_MC related names
        "leicraft",
        "leios"
    ] as const;

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
        .min(3, "Package names must be at least 3 characters long (publisher.pkg).")
        .max(200, "Package names cannot exceed 200 characters.")
        .regex(
            /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/,
            "Package name must follow pattern: publisher.pkgname or publisher.group.pkgname"
        )
        .refine((name) => {
            // Extract final component (package short name)
            const parts = name.split('.');
            const pkgShortName = parts[parts.length - 1];
            return !ForbiddenPackageNames.includes(pkgShortName as any);
        }, {
            message: "The package short name is reserved and cannot be used."
        });

    /**
     * Helper to construct package name from publisher, groups, and package short name
     */
    export function constructPackageName(publisher: string, groups: string[], packageShortName: string): string {
        return [publisher, ...groups, packageShortName].join('.');
    }

    /**
     * Helper to parse package name into components
     */
    export function parsePackageName(packageName: string): {
        publisher: string;
        groups: string[];
        packageShortName: string;
    } {
        const parts = packageName.split('.');
        if (parts.length < 2) {
            throw new Error("Invalid package name format");
        }
        return {
            publisher: parts[0],
            groups: parts.slice(1, -1),
            packageShortName: parts[parts.length - 1],
        };
    }

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

export namespace PackageModel.GetPackageByName {
    
    export const Response = createSelectSchema(DB.Tables.packages, {
        latest_stable_release: z.object({
            amd64: z.string().nullable(),
            arm64: z.string().nullable(),
        }),
        latest_testing_release: z.object({
            amd64: z.string().nullable(),
            arm64: z.string().nullable(),
        })
    });

    export type Response = z.infer<typeof Response>;

}

export namespace PackageModel.GetAll {

    export const Response = z.array(PackageModel.GetPackageByName.Response);
    export type Response = z.infer<typeof Response>;

}

export namespace PackageModel.CreatePackageAsAdmin {

    export const Body = createInsertSchema(DB.Tables.packages, {
        name: PackageModel.PackageNameSchema,
        homepage_url: z.string().url("Homepage URL must be a valid URL."),
        description: z.string().min(1, "Description is required").max(500, "Description cannot exceed 500 characters."),
    }).omit({
        id: true,
        created_at: true,
        flags: true,
        latest_stable_release: true,
        latest_testing_release: true
    });

    export type Body = z.infer<typeof Body>;

}

export namespace PackageModel.CreatePackage {

    export const Body = z.object({
        name: PackageModel.PackageNameSchema,
        description: z.string().min(1, "Description is required").max(500, "Description cannot exceed 500 characters."),
        homepage_url: z.string().url("Homepage URL must be a valid URL."),
        requires_patching: z.boolean().default(false),
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