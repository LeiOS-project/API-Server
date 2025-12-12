import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { DB } from "../../../db";
import z from "zod";

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
        name: z.string().regex(
            /^[a-z0-9][a-z0-9+.-]{1,62}$/,
            "Package names must be 2-63 chars, lowercase, and may contain + - ."
        )
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

    export const Body = createUpdateSchema(DB.Schema.packages).omit({
        name: true,
        owner_user_id: true
    }).partial().refine(
        (data) => Object.values(data).some((value) => value !== undefined),
        { message: "At least one field must be provided" }
    );

    export type Body = z.infer<typeof Body>;

}