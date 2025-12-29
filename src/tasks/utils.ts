import { Logger } from "@hey-api/openapi-ts";
import { ConfigHandler } from "../utils/config";

export class TaskUtils {

    static async getLogsForTask(taskID: number): Promise<string | null> {
        try {
            const logs = Bun.file((ConfigHandler.getConfig()?.LRA_LOG_DIR || "./data/logs") + `/tasks/task-${taskID}.log`);

            if (!await logs.exists()) {
                return null;
            }

            return await logs.text();
        } catch (err) {
            Logger.error("Failed to read task logs:", (err as Error).message);
            return null;
        }
    }

}
