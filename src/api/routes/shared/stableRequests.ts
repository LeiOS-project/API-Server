import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import { DB } from "../../../db";

export namespace StablePromotionRequestsModel {

    export const Status = z.enum(["pending", "approved", "denied"]);
    export type Status = z.infer<typeof Status>;

    export const Entity = createSelectSchema(DB.Schema.stablePromotionRequests);
    export type Entity = z.infer<typeof Entity>;

    export const Pending = Entity.extend({
        status: z.literal("pending")
    });
    export type Pending = z.infer<typeof Pending>;

    export const Approved = Entity.extend({
        status: z.literal("approved")
    });
    export type Approved = z.infer<typeof Approved>;

    export const Denied = Entity.extend({
        status: z.literal("denied"),
        decision_reason: z.string()
    });
    export type Denied = z.infer<typeof Denied>;

    export namespace GetAll {
        export const Query = z.object({
            status: Status.optional()
        });

        export const Response = z.array(Entity);
        export type Response = z.infer<typeof Response>;
    }

    export namespace Create {
        export const Body = z.object({
            version: z.string().min(1),
            arch: z.enum(["amd64", "arm64"]),
            leios_patch: z.number().int().nonnegative().optional(),
        });

        export const Response = z.object({
            id: z.number()
        });
        export type Body = z.infer<typeof Body>;
        export type Response = z.infer<typeof Response>;
    }

    export namespace Decision {
        export const Body = z.object({
            decision: z.enum(["approve", "deny"]),
            reason: z.string().min(1).max(500).optional(),
        });

        export type Body = z.infer<typeof Body>;
    }

    export namespace CopyToStable {
        export const Body = z.object({
            version: z.string().min(1),
            arch: z.enum(["amd64", "arm64"]),
            leios_patch: z.number().int().nonnegative().optional(),
        });

        export const Response = z.object({
            version: z.string(),
            arch: z.enum(["amd64", "arm64"]),
            leios_patch: z.number().int().nonnegative().optional(),
            copied: z.literal(true)
        });
        export type Body = z.infer<typeof Body>;
        export type Response = z.infer<typeof Response>;
    }

}
