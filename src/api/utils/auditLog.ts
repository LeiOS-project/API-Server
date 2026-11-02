import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
import { Logger } from "../../utils/logger";
import type { AuthHandler } from "./authHandler";
import type { ModerationSettings } from "./shared-models/moderation";

/** Records admin and publisher-management actions in the `audit_log` table. */
export class AuditLog {
	/**
	 * Writes one entry. Never throws: a failed write is logged, so it cannot undo or block the
	 * action it describes. Pass the transaction the action runs in to record it atomically.
	 */
	static async record(entry: AuditLog.NewEntry, tx: DrizzleDB = DB.instance()) {
		try {
			await tx
				.insert(DB.Tables.auditLog)
				.values({
					actor_user_id: AuditLog.actorID(entry.actor),
					action: entry.action,
					target_type: entry.targetType,
					target_id:
						entry.targetID === undefined || entry.targetID === null ? null : String(entry.targetID),
					target_label: entry.targetLabel ?? null,
					metadata: entry.metadata ?? {},
				})
				.run();
		} catch (error) {
			Logger.error(`Failed to write audit log entry "${entry.action}":`, error);
		}
	}

	protected static actorID(actor: AuditLog.NewEntry["actor"]) {
		if (actor === null || typeof actor === "number") return actor;
		return actor.type === "unauthenticated" ? null : actor.user_id;
	}
}

export namespace AuditLog {
	export interface NewEntry {
		/** The acting user: an auth context, a user id, or null for system actions. */
		actor: AuthHandler.AuthContext | number | null;
		/** Dotted verb, e.g. "user.suspend". */
		action: string;
		targetType: ModerationSettings.AuditTargetType;
		targetID?: string | number | null;
		/** Readable name of the target (username, package fullname, …) kept after deletion. */
		targetLabel?: string | null;
		metadata?: Record<string, unknown>;
	}
}
