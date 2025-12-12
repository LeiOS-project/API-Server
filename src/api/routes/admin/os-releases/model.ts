import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { DB } from "../../../../db";
import { z } from "zod";

export namespace OSReleasesModel {

    export const Param = z.object({
        version: z.string().regex(/^\d{4}\.\d{2}\.\d{2}$/),
    });

}

export namespace OSReleasesModel.GetByVersion {

    export const Response = createSelectSchema(DB.Schema.os_releases)

    export type Response = z.infer<typeof Response>;

}

export namespace OSReleasesModel.GetAll {

    export const Response = z.array(OSReleasesModel.GetByVersion.Response);

    export type Response = z.infer<typeof Response>;

}

export namespace OSReleasesModel.CreateRelease {

    export const Response = z.object({
        version: z.string(),
        taskID: z.number(),
    });

    export type Response = z.infer<typeof Response>;
}