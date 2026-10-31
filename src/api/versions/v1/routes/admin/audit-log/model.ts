import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import { DB } from "../../../../../../db";
import { ApiHelperModels } from "../../../../../utils/shared-models/api-helper-models";
import { ModerationSettings } from "../../../../../utils/shared-models/moderation";

export namespace AuditLogModel {
	export const Entity = createSelectSchema(DB.Tables.auditLog, {
		target_type: ModerationSettings.AuditTargetType,
		metadata: z.record(z.string(), z.unknown()),
	}).extend({
		actor_username: z.string().nullable(),
	});
	export type Entity = z.infer<typeof Entity>;
}

export namespace AuditLogModel.GetAll {
	export const Query = ApiHelperModels.ListAll.Query.extend({
		actor_user_id: z.coerce.number().int().positive().optional(),
		/** Exact action ("user.suspend") or a prefix ending in a dot ("user."). */
		action: z.string().min(1).max(64).optional(),
		target_type: ModerationSettings.AuditTargetType.optional(),
		target_id: z.string().min(1).max(256).optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = ApiHelperModels.Paginated(AuditLogModel.Entity);
	export type Response = z.infer<typeof Response>;
}
