import { eq, asc, or, and } from "drizzle-orm";
import { DB } from "../db";
import { Logger } from "../utils/logger";
import { TaskHandler } from "@cleverjs/utils";
import { OsReleaseTask } from "./osRelease";
import { ConfigHandler } from "../utils/config";
import fs from "fs";
import { UpdateTestingRepoTask } from "./updateTestingRepo";

type AdditionalTaskMeta = {
	created_by_user_id: number | null;
};
type TaskData = TaskHandler.BaseTaskData<AdditionalTaskMeta>;

export class TaskStorage extends TaskHandler.AbstractStorageDriver<TaskData, AdditionalTaskMeta> {

	private transportToDBFormat(task: TaskData, withID?: true): DB.Models.ScheduledTask;
	private transportToDBFormat(task: TaskData, withID: false): Omit<DB.Models.ScheduledTask, "id">;
	private transportToDBFormat(task: TaskData, withID = true): DB.Models.ScheduledTask {
		return {//@ts-ignore
			id: withID ? task.id! : undefined,
			function: task.fn,
			created_by_user_id: task.created_by_user_id,
			args: task.args,
			status: task.status,
			autoDelete: task.execOptions?.autoDelete ?? false,
			storeLogs: task.execOptions?.storeLogs ?? false,
			created_at: task.created_at,
			finished_at: task.finished_at ?? null,
			result: task.result ?? null,
			message: task.message ?? null
		};
	}

	private transportFromDBFormat(dbModel: DB.Models.ScheduledTask): TaskData {
		return {
			id: dbModel.id,
			fn: dbModel.function,
			created_by_user_id: dbModel.created_by_user_id,
			args: dbModel.args,
			status: dbModel.status,
			execOptions: {
				autoDelete: dbModel.autoDelete,
				storeLogs: dbModel.storeLogs
			},
			created_at: dbModel.created_at,
			finished_at: dbModel.finished_at,
			result: dbModel.result,
			message: dbModel.message
		};
	}

	async loadTask(id: number): Promise<TaskData | null> {
		const data = DB.instance().select().from(DB.Schema.scheduled_tasks).where(
			eq(DB.Schema.scheduled_tasks.id, id)
		).get();
		if (!data)
			return null;
		return this.transportFromDBFormat(data);
	}

	async createTask(data: Omit<TaskData, "id">): Promise<number> {
		const result = DB.instance().insert(DB.Schema.scheduled_tasks).values(
			this.transportToDBFormat(data as any, false)
		).returning().get();
		return result.id;
	}

	async updateTask(data: TaskData): Promise<void> {
		await DB.instance().update(DB.Schema.scheduled_tasks).set(
			this.transportToDBFormat(data, false)
		).where(
			eq(DB.Schema.scheduled_tasks.id, data.id!)
		);
	}

	async deleteTask(id: number): Promise<void> {
		await DB.instance().delete(DB.Schema.scheduled_tasks).where(
			eq(DB.Schema.scheduled_tasks.id, id)
		);
	}

	async loadPausedOrPendingTasks(): Promise<TaskData[]> {
		const rows = DB.instance().select().from(DB.Schema.scheduled_tasks).where(
			or(
				eq(DB.Schema.scheduled_tasks.status, "paused"),
				eq(DB.Schema.scheduled_tasks.status, "pending")
			)
			// tasks ordered by creation time. oldest first
		).orderBy(asc(DB.Schema.scheduled_tasks.created_at)).all();

		return rows.map(row => this.transportFromDBFormat(row));
	}

	async loadFinishedTasksWithAutoDelete(): Promise<TaskData[]> {
		const rows = DB.instance().select().from(DB.Schema.scheduled_tasks).where(
			and(
				eq(DB.Schema.scheduled_tasks.status, "completed"),
				eq(DB.Schema.scheduled_tasks.autoDelete, true)
			)
		).orderBy(asc(DB.Schema.scheduled_tasks.finished_at)).all();
		return rows.map(row => this.transportFromDBFormat(row));
	}


	async loadPausedTaskState(taskID: number): Promise<TaskHandler.TempPausedTaskState | null> {
		const row = DB.instance().select().from(DB.Schema.scheduled_tasks_paused_state).where(
			eq(DB.Schema.scheduled_tasks_paused_state.task_id, taskID)
		).get();
		if (!row)
			return null;
		return {
			nextStepToExecute: row.next_step_to_execute,
			data: row.data
		};
	}

	async savePausedTaskState(taskID: number, pausedState: TaskHandler.TempPausedTaskState): Promise<void> {
		const existing = DB.instance().select().from(DB.Schema.scheduled_tasks_paused_state).where(
			eq(DB.Schema.scheduled_tasks_paused_state.task_id, taskID)
		).get();
		if (existing) {
			await DB.instance().update(DB.Schema.scheduled_tasks_paused_state).set({
				next_step_to_execute: pausedState.nextStepToExecute,
				data: pausedState.data
			}).where(
				eq(DB.Schema.scheduled_tasks_paused_state.task_id, taskID)
			);
		} else {
			await DB.instance().insert(DB.Schema.scheduled_tasks_paused_state).values({
				task_id: taskID,
				next_step_to_execute: pausedState.nextStepToExecute,
				data: pausedState.data
			});
		}
	}

	async deletePausedTaskState(taskID: number): Promise<void> {
		await DB.instance().delete(DB.Schema.scheduled_tasks_paused_state).where(
			eq(DB.Schema.scheduled_tasks_paused_state.task_id, taskID)
		);
	}

}

class PersistentLogger implements TaskHandler.PersistentTaskLoggerLike {

	readonly type = "persistent";

	private readonly writeStream: fs.WriteStream;

	constructor(taskID: number) {
		const filePath = (ConfigHandler.getConfig()?.LRA_LOG_DIR || "./data/logs") + `/tasks/task-${taskID}.log`;
		this.writeStream = fs.createWriteStream(filePath, { flags: "a" });
	}

	public debug(...msg: string[]) {
		this.writeStream.write("[DEBUG] " + msg.join(" ") + "\n");
	}

	public info(...msg: string[]) {
		this.writeStream.write("[INFO] " + msg.join(" ") + "\n");
	}

	public warn(...msg: string[]) {
		this.writeStream.write("[WARN] " + msg.join(" ") + "\n");
	}

	public error(...msg: string[]) {
		this.writeStream.write("[ERROR] " + msg.join(" ") + "\n");	
	}

	async close() {
		throw new Error("Method not implemented.");
	}

}

const Registry = new TaskHandler.TaskFNRegistry()
.register(OsReleaseTask)
.register(UpdateTestingRepoTask);

export const TaskScheduler = new TaskHandler<typeof Registry["registry"], InstanceType<typeof TaskStorage>, TaskData, AdditionalTaskMeta>({
	storage: new TaskStorage(),
	defaultLogger: Logger,
	persistentLogger: PersistentLogger
}, Registry);

