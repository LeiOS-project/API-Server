import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import { DB } from "../../../../../../db";
import { ApiHelperModels } from "../../../../../utils/shared-models/api-helper-models";

export namespace AdminPublishersModel {
	export const Param = z.object({
		publisherName: z.string().min(1),
	});

	export const Entity = createSelectSchema(DB.Tables.publishers).extend({
		owner_username: z.string(),
		package_count: z.number().int(),
		member_count: z.number().int(),
	});
	export type Entity = z.infer<typeof Entity>;
}

export namespace AdminPublishersModel.GetAll {
	export const Query = ApiHelperModels.ListAll.Query.omit({ order: true }).extend({
		search: z.string().min(1).max(64).optional(),
		verified: ApiHelperModels.QueryBoolean.optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = ApiHelperModels.Paginated(AdminPublishersModel.Entity);
	export type Response = z.infer<typeof Response>;
}
