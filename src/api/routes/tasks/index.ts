import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { APIResponseSpec, APIRouteSpec } from "../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { TaskScheduler } from "../../../tasks";
import { APIResponse } from "../../utils/api-res";
import { TaskStatusSchema } from "../../utils/shared-models/tasks";

export const router = new Hono().basePath("/tasks");

router.get(
    "/:taskId",
    APIRouteSpec.authenticated({
        summary: "Get task status",
        description: "Retrieve status of a queued long-running task.",
        tags: [DOCS_TAGS.ADMIN_API.BASE],
        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Task status retrieved", TaskStatusSchema),
            APIResponseSpec.notFound("Task not found")
        )
    }),
    zValidator("param", z.object({
        taskId: z.coerce.number().int().positive()
    })),
    async (c) => {
        const { taskId } = c.req.valid("param");
        const task = await TaskScheduler.get(taskId);
        if (!task) {
            return APIResponse.notFound(c, "Task not found");
        }

        let parsedResult: unknown = null;
        if (task.result) {
            try {
                parsedResult = JSON.parse(task.result as unknown as string);
            } catch {
                parsedResult = task.result;
            }
        }

        return APIResponse.success(c, "Task status retrieved", {
            ...task,
            result: parsedResult
        });
    }
);
