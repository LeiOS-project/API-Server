import z from "zod";
import { UserAccountSettings } from "../../../../../../utils/shared-models/accountData";
import { StablePromotionSettings } from "../../../../../../utils/shared-models/stablePromotion";

export namespace StablePromotionRequestsModel {
	export const Status = StablePromotionSettings.Status;
	export type Status = StablePromotionSettings.Status;

	export const Param = z.object({
		stablePromotionRequestID: z.coerce.number().int().positive(),
	});

	/** What anyone can see about a request: its status and, once released, the OS release. */
	export const Entity = z.object({
		id: z.number().int(),
		package_id: z.number().int(),
		package_release_id: z.number().int(),
		status: StablePromotionSettings.Status,
		created_at: z.number().int(),
		status_changed_at: z.number().int().nullable(),
		os_release_version: z.string().nullable().describe("The OS release that released it"),

		package_name: z.string(),
		package_fullname: z.string(),
		package_release_version: z.string(),

		comment_count: z.number().int().describe("Comments in the conversation"),
		last_message_at: z.number().int().nullable(),
	});
	export type Entity = z.infer<typeof Entity>;

	/** One entry of a request's conversation: a comment or a status change (with its comment). */
	export const Message = z.object({
		id: z.number().int(),
		request_id: z.number().int(),
		kind: StablePromotionSettings.MessageKind,
		status: StablePromotionSettings.Status.nullable().describe("The new status of a status change"),
		body: z.string().describe("Markdown; empty for a status change without a comment"),
		created_at: z.number().int(),
		author_user_id: z
			.number()
			.int()
			.nullable()
			.describe("null for system entries and deleted accounts"),
		author_username: z.string().nullable(),
		author_display_name: z.string().nullable(),
		author_role: UserAccountSettings.Role.nullable().describe("The author's site role"),
	});
	export type Message = z.infer<typeof Message>;
}

export namespace StablePromotionRequestsModel.GetByID {
	export const Response = StablePromotionRequestsModel.Entity;
	export type Response = z.infer<typeof Response>;
}

export namespace StablePromotionRequestsModel.GetAll {
	export const Query = z.object({
		status: StablePromotionRequestsModel.Status.optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.array(StablePromotionRequestsModel.Entity);
	export type Response = z.infer<typeof Response>;
}

export namespace StablePromotionRequestsModel.Create {
	export const Body = z
		.object({
			message: StablePromotionSettings.MessageBody.optional().describe(
				"Why the release should go to stable (Markdown); starts the conversation",
			),
		})
		.strict();
	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		id: z.number(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace StablePromotionRequestsModel.GetMessages {
	export const Response = z.array(StablePromotionRequestsModel.Message);
	export type Response = z.infer<typeof Response>;
}

export namespace StablePromotionRequestsModel.CreateMessage {
	export const Body = z.object({
		body: StablePromotionSettings.MessageBody,
	});
	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		id: z.number().int(),
	});
	export type Response = z.infer<typeof Response>;
}
