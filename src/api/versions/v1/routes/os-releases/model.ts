import z from "zod";
import { ApiHelperModels } from "../../../../utils/shared-models/api-helper-models";

export namespace PublicOSReleasesModel {
	export const Param = z.object({
		version: z.string().regex(/^\d{4}\.\d{2}\.\d{3}$/),
	});

	export const Entity = z.object({
		version: z.string(),
		changelog: z.string(),
		published_at: z.number().int(),
	});
	export type Entity = z.infer<typeof Entity>;
}

export namespace PublicOSReleasesModel.GetAll {
	export const Query = ApiHelperModels.ListAll.Query;
	export type Query = z.infer<typeof Query>;

	export const Response = ApiHelperModels.Paginated(PublicOSReleasesModel.Entity);
	export type Response = z.infer<typeof Response>;
}

export namespace PublicOSReleasesModel.GetByVersion {
	export const Response = PublicOSReleasesModel.Entity;
	export type Response = z.infer<typeof Response>;
}
