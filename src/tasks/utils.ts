import { ConfigHandler } from "../utils/config";
import { Logger } from "../utils/logger";

export class TaskUtils {
	/** `<LOG_DIR>/tasks/task-<id>.log`, where tasks started with `storeLogs` write their log. */
	static getTaskLogFilePath(taskID: number) {
		return `${ConfigHandler.getConfig()?.LOG_DIR ?? "./data/logs"}/tasks/task-${taskID}.log`;
	}

	static async getLogsForTask(taskID: number): Promise<string | null> {
		try {
			const logs = Bun.file(TaskUtils.getTaskLogFilePath(taskID));

			if (!(await logs.exists())) {
				return null;
			}

			return await logs.text();
		} catch (err) {
			Logger.error("Failed to read task logs:", (err as Error).message);
			return null;
		}
	}
}
