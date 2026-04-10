import { Hono } from "hono";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { TaskStatusModel } from "../../../../../utils/shared-models/taskinfo";
import { validator as zValidator } from "hono-openapi";
import { ApiHelperModels } from "../../../../../utils/shared-models/api-helper-models";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { TaskUtils } from "../../../../../../tasks/utils";
import { asc, desc, eq } from "drizzle-orm";

export const router = new Hono().basePath("/tasks");

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List scheduled tasks",
        description: "Retrieve all scheduled tasks.",
        tags: [DOCS_TAGS.ADMIN_TASKS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Scheduled tasks retrieved", TaskStatusModel.GetAll.Response)
        )
    }),

    zValidator("query", ApiHelperModels.ListAll.QueryWithSearch),

    async (c) => {
        const queryOpts = c.req.valid("query");

        const tasks = await DB.instance().select()
            .from(DB.Tables.scheduled_tasks)
            .orderBy(
                queryOpts.order === "newest" ?
                    desc(DB.Tables.scheduled_tasks.created_at) :
                    asc(DB.Tables.scheduled_tasks.created_at)
            )
            .limit(queryOpts.limit)
            .offset(queryOpts.offset);

        return APIResponse.success(c, "Scheduled tasks retrieved", tasks);
    }
);

router.use('/:taskID/*',

    zValidator("param", TaskStatusModel.Param),

    async (c, next) => {
        // @ts-ignore
        const { taskID } = c.req.valid("param") as { taskID: number };

        const taskData = await DB.instance().select().from(DB.Tables.scheduled_tasks).where(
            eq(DB.Tables.scheduled_tasks.id, taskID)
        ).get();

        if (!taskData) {
            return APIResponse.notFound(c, "Task with specified ID not found");
        }

        // @ts-ignore
        c.set("task", taskData);

        await next();
    }
);

router.get('/:taskID',

    APIRouteSpec.authenticated({
        summary: "Get scheduled task",
        description: "Retrieve details of a specific scheduled task by its ID.",
        tags: [DOCS_TAGS.ADMIN_TASKS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Task retrieved successfully", TaskStatusModel.GetByID.Response),
            APIResponseSpec.notFound("Task with specified ID not found")
        )
    }),

    async (c) => {
        // @ts-ignore
        const taskData = c.get("task") as DB.Models.ScheduledTask;
        return APIResponse.success(c, "Task retrieved successfully", taskData);
    }
);

router.get('/:taskID/logs',

    APIRouteSpec.authenticated({
        summary: "Get scheduled task logs",
        description: "Retrieve logs of a specific scheduled task by its ID.",
        tags: [DOCS_TAGS.ADMIN_TASKS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Task logs retrieved successfully", TaskStatusModel.GetLogsByID.Response),
            APIResponseSpec.badRequest("Logs are not stored for this task"),
            APIResponseSpec.notFound("Task with specified ID not found / Log file not found for this task")
        )
    }),

    async (c) => {
        // @ts-ignore
        const taskData = c.get("task") as DB.Models.ScheduledTask;

        if (!taskData.storeLogs) {
            return APIResponse.badRequest(c, "Logs are not stored for this task");
        }

        const logs = await TaskUtils.getLogsForTask(taskData.id);
        if (logs === null) {
            return APIResponse.notFound(c, "Log file not found for this task");
        }

        return APIResponse.success(c, "Task logs retrieved successfully", { logs });
    }
);
