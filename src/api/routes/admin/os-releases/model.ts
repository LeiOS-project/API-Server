import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { DB } from "../../../../db";
import { z } from "zod";
import { type TuplifyUnion, TaskHandler } from "@cleverjs/utils";

export namespace OSReleasesModel {

    export const Param = z.object({
        version: z.string().regex(/^\d{4}\.\d{2}\.\d{1,3}$/),
    });

}

export namespace OSReleasesModel.GetByVersion {

    export const Response = createSelectSchema(DB.Schema.os_releases).extend({
        published_at: z.number().nullable(),
        publishing_status: z.enum(["pending", "running", "paused", "failed", "completed"] satisfies TuplifyUnion<TaskHandler.BaseTaskData<{}>["status"]>)
    }).omit({
        taskID: true,
    });

    export type Response = z.infer<typeof Response>;

}

export namespace OSReleasesModel.GetAll {

    export const Response = z.array(OSReleasesModel.GetByVersion.Response);

    export type Response = z.infer<typeof Response>;

}

export namespace OSReleasesModel.CreateRelease {

    export const Body = createInsertSchema(DB.Schema.os_releases, {
        changelog: z.string().min(1, "Changelog cannot be empty").max(10000, "Changelog cannot exceed 10,000 characters"),
    }).omit({
        id: true,
        created_at: true,
        taskID: true,
        version: true,
    });

    export type Body = z.infer<typeof Body>;

    export const Response = OSReleasesModel.GetByVersion.Response;

    export type Response = z.infer<typeof Response>;
}

export namespace OSReleasesModel.GetPublishingLogs {

    export const Response = z.object({
        logs: z.string()
    });

    export type Response = z.infer<typeof Response>;

}

export namespace OSReleasesModel.UpdateRelease {

    export const Body = OSReleasesModel.CreateRelease.Body.partial();

    export type Body = z.infer<typeof Body>;

}