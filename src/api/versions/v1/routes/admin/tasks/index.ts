import { and, asc, desc, eq, like, or } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { TaskUtils } from "../../../../../../tasks/utils";
import { APIResponse } from "../../../../../utils/api-res";
import { ApiHelperModels } from "../../../../../utils/shared-models/api-helper-models";
import { TaskStatusModel } from "../../../../../utils/shared-models/taskinfo";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";

export const router = new Hono().basePath("/tasks");

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List scheduled tasks",
		description: "Retrieve all scheduled tasks.",
		tags: [DOCS_TAGS.ADMIN_TASKS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Scheduled tasks retrieved", TaskStatusModel.GetAll.Response),
		),
	}),

	zValidator("query", TaskStatusModel.GetAll.Query),

	async (c) => {
		const queryOpts = c.req.valid("query");

		const where = and(
			queryOpts.status ? eq(DB.Tables.scheduled_tasks.status, queryOpts.status) : undefined,
			queryOpts.searchString
				? or(
						like(DB.Tables.scheduled_tasks.function, `%${queryOpts.searchString}%`),
						like(DB.Tables.scheduled_tasks.message, `%${queryOpts.searchString}%`),
					)
				: undefined,
		);

		const items = await DB.instance()
			.select()
			.from(DB.Tables.scheduled_tasks)
			.where(where)
			.orderBy(
				queryOpts.order === "newest"
					? desc(DB.Tables.scheduled_tasks.created_at)
					: asc(DB.Tables.scheduled_tasks.created_at),
			)
			.limit(queryOpts.limit)
			.offset(queryOpts.offset);

		const total = await DB.instance().$count(DB.Tables.scheduled_tasks, where);

		return APIResponse.success(c, "Scheduled tasks retrieved", {
			items,
			total,
		} satisfies TaskStatusModel.GetAll.Response);
	},
);

router.use(
	"/:taskID/*",

	zValidator("param", TaskStatusModel.Param),

	async (c, next) => {
		// @ts-expect-error
		const { taskID } = c.req.valid("param") as { taskID: number };

		const taskData = await DB.instance()
			.select()
			.from(DB.Tables.scheduled_tasks)
			.where(eq(DB.Tables.scheduled_tasks.id, taskID))
			.get();

		if (!taskData) {
			return APIResponse.notFound(c, "Task with specified ID not found");
		}

		// @ts-expect-error
		c.set("task", taskData);

		await next();
	},
);

router.get(
	"/:taskID",

	APIRouteSpec.authenticated({
		summary: "Get scheduled task",
		description: "Retrieve details of a specific scheduled task by its ID.",
		tags: [DOCS_TAGS.ADMIN_TASKS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Task retrieved successfully", TaskStatusModel.GetByID.Response),
			APIResponseSpec.notFound("Task with specified ID not found"),
		),
	}),

	async (c) => {
		// @ts-expect-error
		const taskData = c.get("task") as DB.Models.ScheduledTask;
		return APIResponse.success(c, "Task retrieved successfully", taskData);
	},
);

router.get(
	"/:taskID/logs",

	APIRouteSpec.authenticated({
		summary: "Get scheduled task logs",
		description: "Retrieve logs of a specific scheduled task by its ID.",
		tags: [DOCS_TAGS.ADMIN_TASKS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Task logs retrieved successfully",
				TaskStatusModel.GetLogsByID.Response,
			),
			APIResponseSpec.badRequest("Logs are not stored for this task"),
			APIResponseSpec.notFound("Task with specified ID not found / Log file not found for this task"),
		),
	}),

	async (c) => {
		// @ts-expect-error
		const taskData = c.get("task") as DB.Models.ScheduledTask;

		if (!taskData.storeLogs) {
			return APIResponse.badRequest(c, "Logs are not stored for this task");
		}

		const logs = await TaskUtils.getLogsForTask(taskData.id);
		if (logs === null) {
			return APIResponse.notFound(c, "Log file not found for this task");
		}

		return APIResponse.success(c, "Task logs retrieved successfully", { logs });
	},
);
