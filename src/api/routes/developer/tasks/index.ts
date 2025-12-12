import { Hono } from "hono";
import { APIResponseSpec, APIRouteSpec } from "../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { TaskStatusModel } from "../../../utils/shared-models/taskinfo";
import { TaskInfoService } from "../../../utils/services/taskinfo";
import { validator as zValidator } from "hono-openapi";
import z from "zod";

export const router = new Hono().basePath("/tasks");

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List scheduled tasks",
        description: "Retrieve all scheduled tasks.",
        tags: [DOCS_TAGS.DEV_API.TASKS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Scheduled tasks retrieved", TaskStatusModel.GetAll.Response)
        )
    }),

    async (c) => {
        return await TaskInfoService.getAllTasks(c, false);
    }
);

router.use('/:taskID/*',

    zValidator("param", z.object({
        taskID: z.coerce.number()
    })),

    async (c, next) => {
        // @ts-ignore
        const { taskID } = c.req.valid("param") as { taskID: number };

        TaskInfoService.taskMiddleware(c, next, taskID, false);
    }
);

router.get('/:taskID',

    APIRouteSpec.authenticated({
        summary: "Get scheduled task",
        description: "Retrieve details of a specific scheduled task by its ID.",
        tags: [DOCS_TAGS.DEV_API.TASKS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Task retrieved successfully", TaskStatusModel.GetByID.Response)
        )
    }),

    async (c) => {
        return await TaskInfoService.getTaskAfterMiddleware(c);
    }
);

router.get('/:taskID/logs',

    APIRouteSpec.authenticated({
        summary: "Get scheduled task logs",
        description: "Retrieve logs of a specific scheduled task by its ID.",
        tags: [DOCS_TAGS.DEV_API.TASKS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Task logs retrieved successfully", TaskStatusModel.GetLogsByID.Response),
            APIResponseSpec.badRequest("Logs are not stored for this task"),
            APIResponseSpec.notFound("Log file not found for this task")
        )
    }),

    async (c) => {
        return await TaskInfoService.getTaskLogsAfterMiddleware(c);
    }
);