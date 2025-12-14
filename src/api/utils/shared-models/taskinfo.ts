import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../db";

export namespace TaskStatusModel {

    export const Param = z.object({
        taskIDorTag: z.union([z.coerce.number().int().positive(), z.string()])
    });

    export type Param = z.infer<typeof Param>;
}

export namespace TaskStatusModel.GetByIDorTag {

    export const Response = createSelectSchema(DB.Schema.scheduled_tasks).omit({
        function: true,
        created_by_user_id: true,
        args: true,
        autoDelete: true,
    });

    export type Response = z.infer<typeof Response>;

}

export namespace TaskStatusModel.GetAll {

    export const Response = z.array(TaskStatusModel.GetByIDorTag.Response);
    export type Response = z.infer<typeof Response>;

}

export namespace TaskStatusModel.GetLogsByIDorTag {

    export const Response = z.object({
        logs: z.string()
    });

    export type Response = z.infer<typeof Response>;

}