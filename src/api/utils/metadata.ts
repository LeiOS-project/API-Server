import { eq } from "drizzle-orm";
import { DB } from "../../db";
import { z } from "zod";

export class RuntimeMetadata {

    protected static readonly schemas = {
        "os-release-pending-packages": z.array(z.number()).default([]),
    } as const;

    protected static async getMetadata<T extends keyof typeof this.schemas>(key: T): Promise<z.infer<(typeof this.schemas)[T]>> {
        const record = await DB.instance().select().from(DB.Schema.metadata).where(
            eq(DB.Schema.metadata.key, key)
        ).get();

        if (!record) {
            throw new Error(`Metadata with key '${key}' not found`);
        }
        return this.schemas[key].parse(record.data);
    }

    protected static async setMetadata<T extends keyof typeof this.schemas>(key: T, data: z.infer<(typeof this.schemas)[T]>): Promise<void> {
        await DB.instance().update(DB.Schema.metadata).set({
            data: data,
        }).where(
            eq(DB.Schema.metadata.key, key)
        );
    }

    static async getOSReleasePendingPackages() {
        return await this.getMetadata("os-release-pending-packages");
    }

    static async addOSReleasePendingPackage(packageReleaseId: number) {
        const pendingPackages = await this.getOSReleasePendingPackages();
        if (!pendingPackages.includes(packageReleaseId)) {
            pendingPackages.push(packageReleaseId);
            await this.setMetadata("os-release-pending-packages", pendingPackages);
        }
    }

    static async clearOSReleasePendingPackages() {
        await this.setMetadata("os-release-pending-packages", []);
    }

}
