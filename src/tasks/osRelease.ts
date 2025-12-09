import { eq } from "drizzle-orm";
import { DB } from "../db";
import { TaskScheduler } from ".";
import { z } from "zod";
import { Logger } from "../utils/logger";

const PayloadSchema = z.object({
    version: z.string().min(1)
});

export function registerOsReleaseTasks() {
    TaskScheduler.register("os-release:create", async (payload) => {
        const { version } = PayloadSchema.parse(payload);

        const existing = DB.instance().select().from(DB.Schema.os_releases).where(eq(DB.Schema.os_releases.version, version)).get();
        if (existing) {
            throw new Error("OS release already exists");
        }

        // Persist new OS release marker
        await DB.instance().insert(DB.Schema.os_releases).values({ version });

        // TODO: hook actual repo publish/update steps here if available
        Logger.info(`OS release ${version} recorded. Add repo publish logic here if needed.`);

        return { version };
    });
}
