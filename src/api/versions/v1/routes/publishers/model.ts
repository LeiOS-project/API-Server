import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { DB } from "../../../../../db";
import z from "zod";
import { ApiHelperModels } from "../../../../utils/shared-models/api-helper-models";
import { PermissionHelper } from "../../../../../utils/permission-helper";

export namespace PublisherModel {

    const ForbiddenPublisherNames = [
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
        "developer",
        "prod",
        "production",

        "root",
        "sys",
        "system",

        // Forbidden LeiCraft_MC related names
        "leicraft",
        "leios"
    ];


    // Publisher name validation: lowercase, alphanumeric, hyphens allowed
    export const SelectPublisherNameSchema = z.string()
        .min(2, "Publisher name must be at least 2 characters long.")
        .max(50, "Publisher name cannot exceed 50 characters.")
        .regex(
            /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
            "Publisher name must be lowercase, may contain hyphens, and start/end with a letter or number."
        )
    

    // Publisher name validation: lowercase, alphanumeric, hyphens allowed
    export const CreatePublisherNameSchema = SelectPublisherNameSchema
        .refine((name) => !ForbiddenPublisherNames.includes(name), {
            message: "This publisher name is reserved and cannot be used."
        });

    export const OrgRoleSchema = z.enum(PermissionHelper.OrgRolesAsTuple);
}


export namespace PublisherModel.GetPublisherByName {

    export const Response = createSelectSchema(DB.Tables.publishers).omit({
        owner_user_id: true,
    });

    export type Response = z.infer<typeof Response>;

}


export namespace PublisherModel.GetAll {

    export const Query = ApiHelperModels.ListAll.QueryWithSearch.omit({
        order: true
    }).extend({
        onlyMembershipByMe: z.coerce.boolean().default(false)
    });

    export type Query = z.infer<typeof Query>;


    export const Response = z.array(PublisherModel.GetPublisherByName.Response);

    export type Response = z.infer<typeof Response>;

}


export namespace PublisherModel.CreatePublisher {

    export const Body = createInsertSchema(DB.Tables.publishers, {

        name: PublisherModel.CreatePublisherNameSchema,
        display_name: z.string().min(1, "Display name is required").max(200, "Display name cannot exceed 200 characters."),
        description: z.string().min(1, "Description is required").max(500, "Description cannot exceed 500 characters."),
        homepage_url: z.url("Homepage URL must be a valid URL.").max(500, "Homepage URL cannot exceed 500 characters."),

    }).omit({
        id: true,
        created_at: true,
        owner_user_id: true,
    });

    export type Body = z.infer<typeof Body>;

    export const Response = z.object({
        id: z.number().int().positive()
    });

    export type Response = z.infer<typeof Response>;
}

export namespace PublisherModel.UpdatePublisher {

    export const Body = PublisherModel.CreatePublisher.Body.omit({

        name: true,

    }).partial().refine(
        (data) => Object.values(data).some((value) => value !== undefined),
        { message: "At least one field must be provided" }
    );

    export type Body = z.infer<typeof Body>;
}

export namespace PublisherModel.TransferOwnership {

    export const Body = z.object({
        new_owner_user_id: z.number().int().positive()
    });

    export type Body = z.infer<typeof Body>;

}

export namespace PublisherModel.Members.GetMemberByID {

    export const Response = createSelectSchema(DB.Tables.publisherMembers).omit({
        publisher_id: true,
    }).extend({
        user_username: z.string(),
        user_display_name: z.string(),
    });

    export type Response = z.infer<typeof Response>;

}

export namespace PublisherModel.Members.ListAll {

    export const Response = z.array(PublisherModel.Members.GetMemberByID.Response);
    export type Response = z.infer<typeof Response>;

}

export namespace PublisherModel.Members.AddMember {

    export const Body = z.object({
        user_id: z.number().int().positive(),
        role: PublisherModel.OrgRoleSchema,
        is_publicly_hidden: z.boolean().optional().default(false)
    });

    export type Body = z.infer<typeof Body>;

    
    export const Response = z.object({
        id: z.number().int().positive()
    });
    
    export type Response = z.infer<typeof Response>;

}

export namespace PublisherModel.Members.UpdateMember {

    export const Body = z.object({
        role: PublisherModel.OrgRoleSchema.optional(),
        is_publicly_hidden: z.boolean().optional()
    }).refine(
        (data) => Object.values(data).some((value) => value !== undefined),
        { message: "At least one field must be provided" }
    );

    export type Body = z.infer<typeof Body>;

}
