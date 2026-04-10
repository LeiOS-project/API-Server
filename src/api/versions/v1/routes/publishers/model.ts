import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { DB } from "../../../../../db";
import z from "zod";
import { ApiHelperModels } from "../../../../utils/shared-models/api-helper-models";

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
    export const PublisherNameSchema = z.string()
        .min(2, "Publisher name must be at least 2 characters long.")
        .max(50, "Publisher name cannot exceed 50 characters.")
        .regex(
            /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
            "Publisher name must be lowercase, may contain hyphens, and start/end with a letter or number."
        )
        .refine((name) => !ForbiddenPublisherNames.includes(name), {
            message: "This publisher name is reserved and cannot be used."
        });
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

        name: PublisherModel.PublisherNameSchema,
        display_name: z.string().min(1, "Display name is required").max(200, "Display name cannot exceed 200 characters."),
        description: z.string().min(1, "Description is required").max(500, "Description cannot exceed 500 characters."),
        homepage_url: z.url("Homepage URL must be a valid URL.").max(500, "Homepage URL cannot exceed 500 characters."),

    }).omit({
        id: true,
        created_at: true,
        owner_user_id: true,
    });

    export type Body = z.infer<typeof Body>;
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
        new_owner_user_id: z.number()
    });

    export type Body = z.infer<typeof Body>;

}