import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import z from "zod";
import { DB } from "../../../db";

export namespace StablePromotionRequestsModel {

    export const Status = z.enum(["pending", "approved", "denied"]);
    export type Status = z.infer<typeof Status>;

    export const Entity = createSelectSchema(DB.Schema.stablePromotionRequests);
    export type Entity = z.infer<typeof Entity>;

    export const Pending = Entity.extend({
        status: z.literal("pending"),
        admin_note: z.null()
    });
    export type Pending = z.infer<typeof Pending>;

    export const Approved = Entity.extend({
        status: z.literal("approved"),
        admin_note: z.string().nullable()
    });
    export type Approved = z.infer<typeof Approved>;

    export const Denied = Entity.extend({
        status: z.literal("denied"),
        admin_note: z.string().nullable()
    });
    export type Denied = z.infer<typeof Denied>;

    export const Union = z.union([Pending, Approved, Denied]);
    export type Union = z.infer<typeof Union>;

}

export namespace StablePromotionRequestsModel.GetAll {

    export const Query = z.object({
        status: Status.optional()
    });
    export type Query = z.infer<typeof Query>;

    export const Response = z.array(Union);
    export type Response = z.infer<typeof Response>;
}

export namespace StablePromotionRequestsModel.Create {
    export const Body = createInsertSchema(DB.Schema.stablePromotionRequests).omit({
        id: true,
        created_at: true,
        package_id: true,
        // package_release_id: true,
        status: true,
        admin_note: true
    });

    export const Response = z.object({
        id: z.number()
    });
    export type Body = z.infer<typeof Body>;
    export type Response = z.infer<typeof Response>;
}

