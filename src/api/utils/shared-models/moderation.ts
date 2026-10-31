import z from "zod";

export namespace ModerationSettings {
	/** What an audit-log entry is about. */
	export const AuditTargetTypes = [
		"user",
		"publisher",
		"package",
		"release",
		"stable_promotion_request",
		"os_release",
		"report",
	] as const;
	export const AuditTargetType = z.enum(AuditTargetTypes);
	export type AuditTargetType = z.infer<typeof AuditTargetType>;

	export const ReportTargetTypes = ["package", "publisher"] as const;
	export const ReportTargetType = z.enum(ReportTargetTypes);
	export type ReportTargetType = z.infer<typeof ReportTargetType>;

	export const ReportReasons = [
		"malware",
		"spam",
		"copyright",
		"inappropriate",
		"broken",
		"impersonation",
		"other",
	] as const;
	export const ReportReason = z.enum(ReportReasons);
	export type ReportReason = z.infer<typeof ReportReason>;

	export const ReportStatuses = ["open", "resolved", "dismissed"] as const;
	export const ReportStatus = z.enum(ReportStatuses);
	export type ReportStatus = z.infer<typeof ReportStatus>;
}
