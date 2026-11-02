import z from "zod";

export namespace StablePromotionSettings {
	/**
	 * Lifecycle of a stable promotion request:
	 * - `pending`: waiting for a reviewer
	 * - `queued`: approved; waits for the next OS release that includes it
	 * - `released`: moved into stable by an OS release (final)
	 * - `denied`: not accepted; a reviewer can reopen it
	 */
	export const Statuses = ["pending", "queued", "released", "denied"] as const;
	export const Status = z.enum(Statuses);
	export type Status = z.infer<typeof Status>;

	/** The statuses a reviewer can set. `released` is set only by the OS release that ships it. */
	export const ReviewStatuses = ["pending", "queued", "denied"] as const;
	export const ReviewStatus = z.enum(ReviewStatuses);
	export type ReviewStatus = z.infer<typeof ReviewStatus>;

	/** A message is either a comment or the record of a status change (with an optional comment). */
	export const MessageKinds = ["comment", "status_change"] as const;
	export const MessageKind = z.enum(MessageKinds);
	export type MessageKind = z.infer<typeof MessageKind>;

	/** Markdown text of a comment. */
	export const MessageBody = z
		.string()
		.trim()
		.min(1, "Message cannot be empty")
		.max(10000, "Message cannot exceed 10,000 characters");
}
