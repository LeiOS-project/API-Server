import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { DB } from "../../../../db";
import z from "zod";

export namespace AdminStablePromotionRequestModel.GetById {

    export const Response = createSelectSchema(DB.Schema.stablePromotionRequests).extend({
        package_name: z.string(),
        package_release_version: z.string()
    });

    export type Response = z.infer<typeof Response>;

}

export namespace AdminStablePromotionRequestModel.GetAll {

    export const Response = z.array(AdminStablePromotionRequestModel.GetById.Response);

    export type Response = z.infer<typeof Response>;

}

export namespace AdminStablePromotionRequestModel.Decide {

    export const Body = createUpdateSchema(DB.Schema.stablePromotionRequests, {
        status: z.enum(["approved", "denied"]),
        admin_note: z.string()
    }).omit({
        id: true,
        package_id: true,
        package_release_id: true,
        created_at: true
    });

    export type Body = z.infer<typeof Body>;
}