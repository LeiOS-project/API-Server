import { createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { DB } from "../../../../../../db";
import z from "zod";
import { ApiHelperModels } from "../../../../../utils/shared-models/api-helper-models";

export namespace AdminStablePromotionRequestModel.GetById {
	export const Response = createSelectSchema(DB.Tables.stablePromotionRequests).extend({
		package_name: z.string(),
		package_fullname: z.string(),
		package_release_version: z.string(),
	});

	export type Response = z.infer<typeof Response>;
}

export namespace AdminStablePromotionRequestModel.GetAll {
	export const Query = ApiHelperModels.ListAll.Query.extend({
		status: z.enum(["pending", "approved", "denied"]).optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = ApiHelperModels.Paginated(
		AdminStablePromotionRequestModel.GetById.Response,
	);

	export type Response = z.infer<typeof Response>;
}

export namespace AdminStablePromotionRequestModel.Decide {
	export const Body = createUpdateSchema(DB.Tables.stablePromotionRequests, {
		status: z.enum(["approved", "denied"]),
		admin_note: z.string(),
	}).omit({
		id: true,
		package_id: true,
		package_release_id: true,
		created_at: true,
	});

	export type Body = z.infer<typeof Body>;
}
