import { eq, asc } from "drizzle-orm";
import { DB } from "../db";
import { Logger } from "../utils/logger";

type TaskHandlerResult = unknown;
type TaskHandler = (payload: unknown) => Promise<TaskHandlerResult> | TaskHandlerResult;

export class TaskScheduler {

	private static handlers: Map<string, TaskHandler> = new Map();
	private static isProcessing = false;

	static register(jobType: string, handler: TaskHandler) {
		this.handlers.set(jobType, handler);
	}

	static async enqueue(jobType: string, payload: unknown, trigger: "manual" = "manual") {
		const now = Date.now();
		const record = DB.instance().insert(DB.Schema.scheduled_tasks).values({
			job_type: jobType,
			trigger,
			function: jobType,
			payload: JSON.stringify(payload),
			status: "queued",
			created_at: now,
			updated_at: now
		}).returning().get();

		this.processQueue();
		return record;
	}

	static async runNext(): Promise<number | null> {
		const task = DB.instance().select().from(DB.Schema.scheduled_tasks)
			.where(eq(DB.Schema.scheduled_tasks.status, "queued"))
			.orderBy(asc(DB.Schema.scheduled_tasks.id))
			.limit(1)
			.get();
		if (!task) return null;

		const handler = this.handlers.get(task.job_type);
		if (!handler) {
			Logger.warn(`No handler registered for job type ${task.job_type}, marking as failed`);
			await this.markFailed(task.id, "no-handler", "No handler registered for job type");
			return task.id;
		}

		let parsedPayload: unknown = null;
		try {
			parsedPayload = task.payload ? JSON.parse(task.payload as unknown as string) : null;
		} catch (err) {
			Logger.error(`Failed to parse payload for task ${task.id}:`, err);
			await this.markFailed(task.id, "invalid-payload", err instanceof Error ? err.message : String(err));
			return task.id;
		}

		try {
			await this.markRunning(task.id);
			const result = await handler(parsedPayload);
			await this.markCompleted(task.id, result);
			return task.id;
		} catch (err) {
			Logger.error(`Task ${task.id} (${task.job_type}) failed:`, err);
			await this.markFailed(task.id, "error", err instanceof Error ? err.message : String(err));
			return task.id;
		}
	}

	static async runAllPending() {
		const completed: number[] = [];
		// Iterate until queue is empty or a task fails without handler.
		while (true) {
			const nextId = await this.runNext();
			if (!nextId) break;
			completed.push(nextId);
		}
		return completed;
	}

	static async get(taskId: number) {
		return DB.instance().select().from(DB.Schema.scheduled_tasks).where(eq(DB.Schema.scheduled_tasks.id, taskId)).get();
	}

	static async processQueue() {
		if (this.isProcessing) return;
		this.isProcessing = true;
		try {
			while (await this.runNext()) {
				// loop until no queued tasks remain
			}
		} finally {
			this.isProcessing = false;
		}
	}

	private static async markRunning(taskId: number) {
		const now = Date.now();
		await DB.instance().update(DB.Schema.scheduled_tasks).set({
			status: "running",
			updated_at: now,
			started_at: now
		}).where(eq(DB.Schema.scheduled_tasks.id, taskId));
	}

	private static async markCompleted(taskId: number, result: TaskHandlerResult) {
		const now = Date.now();
		await DB.instance().update(DB.Schema.scheduled_tasks).set({
			status: "completed",
			updated_at: now,
			completed_at: now,
			result: result === undefined ? null : JSON.stringify(result)
		}).where(eq(DB.Schema.scheduled_tasks.id, taskId));
	}

	private static async markFailed(taskId: number, code: string, message: string) {
		const now = Date.now();
		await DB.instance().update(DB.Schema.scheduled_tasks).set({
			status: "failed",
			updated_at: now,
			error: `${code}: ${message}`
		}).where(eq(DB.Schema.scheduled_tasks.id, taskId));
	}
}
