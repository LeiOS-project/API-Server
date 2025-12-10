import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { DB } from "../../../../db";
import { z } from "zod";

export namespace OSReleases.GetById {

    export const Response = createSelectSchema(DB.Schema.os_releases)

    export type Response = z.infer<typeof Response>;

}

export namespace OSReleases.GetAll {

    export const Response = z.array(OSReleases.GetById.Response);

    export type Response = z.infer<typeof Response>;

}

export namespace OSReleases.CreateRelease {

    export const Request = createInsertSchema(DB.Schema.os_releases).omit({
        id: true,
        version: true,
        published_at: true
    });

    export type Request = z.infer<typeof Request>;

    export const Response = createSelectSchema(DB.Schema.os_releases);

    export type Response = z.infer<typeof Response>;

}