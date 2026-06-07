import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { DB } from "../../../db";
import z from "zod";
import { ApiHelperModels } from "./api-helper-models";
import { PermissionHelper } from "../../../utils/permission-helper";

export namespace PackageModel {

    export const PackageNameSchema = z.string()
        .min(2, "Package short names must be at least 2 characters long.")
        .max(200, "Package short names cannot exceed 200 characters.")
        .regex(
            /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/,
            "Package name must be lowercase alphanumeric (hyphens and dots allowed) and start/end with a letter or number."
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

    export const Param = z.object({
        fullPackageName: z.string()
    });

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
        fullname: z.string()
    });

    export type Response = z.infer<typeof Response>;

}

export namespace PackageModel.GetAll {

    export const Query = ApiHelperModels.ListAll.QueryWithSearch.omit({
        order: true
    }).extend({

        publisherID: z.coerce.number().int().min(1).optional(),
        publisherName: z.string().min(1).optional(),

        onlyMembershipByMe: z.coerce.boolean().default(false)

    }).refine(
        (data) => !(data.publisherID !== undefined && data.publisherName !== undefined),
        {
            message: "You can provide either 'publisherID' or 'publisherName', but not both.",
            path: ["publisherName"],
        }
    );

    export type Query = z.infer<typeof Query>;

    export const Response = z.array(PackageModel.GetPackageByFullName.Response);
    export type Response = z.infer<typeof Response>;

}

export namespace PackageModel.CreatePackage {

    export const Body = createInsertSchema(DB.Tables.packages, {

        name: PackageModel.PackageNameSchema,
        display_name: z.string().min(1, "Display name is required").max(200, "Display name cannot exceed 200 characters."),
        description: z.string().min(1, "Description is required").max(500, "Description cannot exceed 500 characters."),
        homepage_url: z.url("Homepage URL must be a valid URL.").max(500, "Homepage URL cannot exceed 500 characters."),
        requires_patching: z.boolean().default(false),

    }).omit({
        id: true,
        created_at: true,
        flags: true,
        top_level_alias: true,
        latest_stable_release: true,
        latest_testing_release: true
    });


    export type Body = z.infer<typeof Body>;
}

export namespace PackageModel.UpdatePackage {

    export const Body = PackageModel.CreatePackage.Body.omit({
        name: true,
        publisher_id: true,
    }).partial().refine(
        (data) => Object.values(data).some((value) => value !== undefined),
        { message: "At least one field must be provided" }
    );

    export type Body = z.infer<typeof Body>;

}

export namespace PackageModel.RoleAssignment {

    export const Entity = createSelectSchema(DB.Tables.roleAssignments);
    export type Entity = z.infer<typeof Entity>;

    export const EntityWithUser = Entity.extend({
        user_username: z.string(),
        user_display_name: z.string().nullable(),
        publisher_role: z.string().nullable(),
    });
    export type EntityWithUser = z.infer<typeof EntityWithUser>;

}

export namespace PackageModel.ListRoleAssignments {

    export const Response = z.array(PackageModel.RoleAssignment.EntityWithUser);
    export type Response = z.infer<typeof Response>;

}

export namespace PackageModel.CreateRoleAssignment {

    export const Body = z.object({
        user_id: z.number().int().positive(),
        role: z.enum(PermissionHelper.OrgRolesAsTuple)
    });

    export type Body = z.infer<typeof Body>;

}

export namespace PackageModel.UpdateRoleAssignment {

    export const Body = z.object({
        role: z.enum(PermissionHelper.OrgRolesAsTuple)
    });

    export type Body = z.infer<typeof Body>;

}
