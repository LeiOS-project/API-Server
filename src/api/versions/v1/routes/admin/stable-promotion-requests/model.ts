import z from "zod";
import { ApiHelperModels } from "../../../../../utils/shared-models/api-helper-models";
import { StablePromotionSettings } from "../../../../../utils/shared-models/stablePromotion";
import { StablePromotionRequestsModel } from "../../packages/releases/stable-promotion-requests/model";

export namespace AdminStablePromotionRequestModel {
	export const Param = StablePromotionRequestsModel.Param;

	const VersionPerArch = z.object({
		amd64: z.string().nullable(),
		arm64: z.string().nullable(),
	});

	/** A request with what reviewers need: the release, the current stable version and who acted. */
	export const Entity = StablePromotionRequestsModel.Entity.extend({
		publisher_id: z.number().int(),
		package_display_name: z.string(),
		package_latest_stable_release: VersionPerArch.describe("Versions in stable right now"),
		package_release_architectures: z.object({
			amd64: z.boolean(),
			arm64: z.boolean(),
			is_all: z.boolean(),
		}),
		package_release_created_at: z.number().int(),

		requested_by_user_id: z.number().int().nullable(),
		requested_by_username: z.string().nullable(),
		status_changed_by_user_id: z.number().int().nullable(),
		status_changed_by_username: z.string().nullable(),
	});
	export type Entity = z.infer<typeof Entity>;
}

export namespace AdminStablePromotionRequestModel.GetById {
	export const Response = AdminStablePromotionRequestModel.Entity;
	export type Response = z.infer<typeof Response>;
}

export namespace AdminStablePromotionRequestModel.GetAll {
	export const Query = ApiHelperModels.ListAll.Query.extend({
		status: StablePromotionSettings.Status.optional(),
		search: z
			.string()
			.trim()
			.min(1)
			.max(100)
			.optional()
			.describe("Matches the package name, display name or release version"),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = ApiHelperModels.Paginated(AdminStablePromotionRequestModel.Entity);
	export type Response = z.infer<typeof Response>;
}

export namespace AdminStablePromotionRequestModel.ChangeStatus {
	export const Body = z.object({
		status: StablePromotionSettings.ReviewStatus.describe(
			"queued approves the release for the next OS release, denied rejects it, pending reopens it or takes it out of the queue",
		),
		message: StablePromotionSettings.MessageBody.optional().describe(
			"Comment for the publisher (Markdown), shown with the status change",
		),
	});
	export type Body = z.infer<typeof Body>;
}

export namespace AdminStablePromotionRequestModel.GetMessages {
	export const Response = StablePromotionRequestsModel.GetMessages.Response;
	export type Response = z.infer<typeof Response>;
}

export namespace AdminStablePromotionRequestModel.CreateMessage {
	export const Body = StablePromotionRequestsModel.CreateMessage.Body;
	export type Body = z.infer<typeof Body>;

	export const Response = StablePromotionRequestsModel.CreateMessage.Response;
	export type Response = z.infer<typeof Response>;
}
