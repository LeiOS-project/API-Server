import { eq, asc } from "drizzle-orm";
import { DB } from "../db";
import { Logger } from "../utils/logger";

type TaskHandler = (payload: unknown) => Promise<void> | void;

export class TaskScheduler {

	private static handlers: Map<string, TaskHandler> = new Map();

	static register(jobType: string, handler: TaskHandler) {
		this.handlers.set(jobType, handler);
	}

	static async enqueue(jobType: string, payload: unknown, trigger: "manual" = "manual") {
		const record = DB.instance().insert(DB.Schema.scheduled_tasks).values({
			job_type: jobType,
			trigger,
			function: jobType,
			payload: JSON.stringify(payload)
		}).returning().get();

		return record;
	}

	static async runNext(): Promise<number | null> {
		const task = DB.instance().select().from(DB.Schema.scheduled_tasks).orderBy(asc(DB.Schema.scheduled_tasks.id)).limit(1).get();
		if (!task) return null;

		const handler = this.handlers.get(task.job_type);
		if (!handler) {
			Logger.warn(`No handler registered for job type ${task.job_type}, leaving task queued`);
			return null;
		}

		let parsedPayload: unknown = null;
		try {
			parsedPayload = task.payload ? JSON.parse(task.payload as unknown as string) : null;
		} catch (err) {
			Logger.error(`Failed to parse payload for task ${task.id}:`, err);
			return null;
		}

		try {
			await handler(parsedPayload);
			DB.instance().delete(DB.Schema.scheduled_tasks).where(eq(DB.Schema.scheduled_tasks.id, task.id)).run();
			return task.id;
		} catch (err) {
			Logger.error(`Task ${task.id} (${task.job_type}) failed:`, err);
			return null;
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
}
