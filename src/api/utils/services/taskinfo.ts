import { Context } from "hono";
import { DB } from "../../../db";
import { APIResponse } from "../api-res";
import { eq, and, or, like, desc, asc } from "drizzle-orm";
import { AuthHandler } from "../authHandler";
import { ConfigHandler } from "../../../utils/config";
import { ApiHelperModels } from "../shared-models/api-helper-models";
import { TaskUtils } from "../../../tasks/utils";

export class TaskInfoService {

    static async getAllTasks(c: Context, queryOpts: ApiHelperModels.ListAll.Query, asAdmin = false) {

        if (!asAdmin) {

            // @ts-ignore
            const authContext = c.get("authContext") as AuthHandler.AuthContext;

            const tasks = await DB.instance().select()
            .from(DB.Schema.scheduled_tasks)
            .where(
                eq(DB.Schema.scheduled_tasks.created_by_user_id, authContext.user_id),
            )
            .orderBy(
                queryOpts.order === "newest" ?
                    desc(DB.Schema.scheduled_tasks.created_at) :
                    asc(DB.Schema.scheduled_tasks.created_at)
            )
            .limit(queryOpts.limit)
            .offset(queryOpts.offset);
            

            return APIResponse.success(c, "Scheduled tasks retrieved", tasks);
        } else {

            const tasks = await DB.instance().select()
            .from(DB.Schema.scheduled_tasks)
            .orderBy(
                queryOpts.order === "newest" ?
                    desc(DB.Schema.scheduled_tasks.created_at) :
                    asc(DB.Schema.scheduled_tasks.created_at)
            )
            .limit(queryOpts.limit)
            .offset(queryOpts.offset);

            return APIResponse.success(c, "Scheduled tasks retrieved", tasks);
        }
    }

    static async taskMiddleware(c: Context, next: () => Promise<void>, taskID: number, asAdmin = false) {

        let taskData: DB.Models.ScheduledTask | undefined;

        if (!asAdmin) {
            // @ts-ignore
            const authContext = c.get("authContext") as AuthHandler.AuthContext;

            taskData = DB.instance().select().from(DB.Schema.scheduled_tasks).where(and(
                eq(DB.Schema.scheduled_tasks.id, taskID),
                eq(DB.Schema.scheduled_tasks.created_by_user_id, authContext.user_id)
            )).get();
        } else {
            

            taskData = DB.instance().select().from(DB.Schema.scheduled_tasks).where(
                eq(DB.Schema.scheduled_tasks.id, taskID)
            ).get();
        }

        if (!taskData) {
            return APIResponse.notFound(c, "Task with specified ID or Tag not found");
        }
        // @ts-ignore
        c.set("task", taskData);

        await next();
    }

    static async getTaskAfterMiddleware(c: Context) {
        // @ts-ignore
        const taskData = c.get("task") as DB.Models.ScheduledTask;

        return APIResponse.success(c, "Task retrieved successfully", taskData);
    }

    static async getTaskLogsAfterMiddleware(c: Context) {
        // @ts-ignore
        const taskData = c.get("task") as DB.Models.ScheduledTask;

        if (!taskData.storeLogs) {
            return APIResponse.badRequest(c, "Logs are not stored for this task");
        }

        const logs = await TaskUtils.getLogsForTask(taskData.id);
        if (logs === null) {
            return APIResponse.notFound(c, "Log file not found for this task");
        }

        return APIResponse.success(c, "Task logs retrieved successfully", { logs: logs });
    }

}