import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { DB } from "../../../../db";
import z from "zod";

export namespace OSReleases.GetById {

    export const Response = createSelectSchema(DB.Schema.stablePromotionRequests)

    export type Response = z.infer<typeof Response>;

}

export namespace OSReleases.GetAll {

    export const Response = z.array(OSReleases.GetById.Response);

    export type Response = z.infer<typeof Response>;

}
