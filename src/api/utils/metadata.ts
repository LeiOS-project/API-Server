import { eq } from "drizzle-orm";
import type { z } from "zod";
import { DB } from "../../db";

/**
 * Small server-side key/value store in the `metadata` table. Each key has a Zod schema whose
 * `.default(...)` is the value of a key that was never written.
 *
 * Add a key by adding its schema to `schemas` and a typed accessor below. (The stable queue that
 * used to live here as `os-release-pending-packages` is now the `queued` status of
 * `stable_promotion_requests`.)
 */
export class RuntimeMetadata {
	protected static readonly schemas = {} as const satisfies Record<string, z.ZodType>;

	protected static async getMetadata<T extends keyof typeof this.schemas>(
		key: T,
	): Promise<z.infer<(typeof this.schemas)[T]>> {
		const schema: z.ZodType = this.schemas[key];
		const record = await DB.instance()
			.select()
			.from(DB.Tables.metadata)
			.where(eq(DB.Tables.metadata.key, key))
			.get();

		return schema.parse(record?.data) as z.infer<(typeof this.schemas)[T]>;
	}

	protected static async setMetadata<T extends keyof typeof this.schemas>(
		key: T,
		value: z.infer<(typeof this.schemas)[T]>,
	): Promise<void> {
		const data = value as DB.Models.Metadata["data"];
		await DB.instance()
			.insert(DB.Tables.metadata)
			.values({ key, data })
			.onConflictDoUpdate({ target: DB.Tables.metadata.key, set: { data } });
	}
}
