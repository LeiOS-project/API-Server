import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../db";

export namespace TaskStatusModel {

    export const Param = z.object({
        taskID: z.coerce.number().int().positive().meta({ title: "Task ID" })
    });

    export type Param = z.infer<typeof Param>;
}

export namespace TaskStatusModel.GetByID {

    export const Response = createSelectSchema(DB.Schema.scheduled_tasks).omit({
        function: true,
        created_by_user_id: true,
        args: true,
        autoDelete: true,
    });

    export type Response = z.infer<typeof Response>;

}

export namespace TaskStatusModel.GetAll {

    export const Response = z.array(TaskStatusModel.GetByID.Response);
    export type Response = z.infer<typeof Response>;

}

export namespace TaskStatusModel.GetLogsByID {

    export const Response = z.object({
        logs: z.string()
    });

    export type Response = z.infer<typeof Response>;

}