import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
import { AuditLog } from "./auditLog";
import type { AuthHandler } from "./authHandler";
import type { StablePromotionSettings } from "./shared-models/stablePromotion";

/**
 * Stable promotion requests and their conversation. A request is `pending` until a reviewer
 * queues or denies it; the OS release that includes a queued request marks it `released`.
 */
export class StablePromotion {
	/** Statuses of an OS release task that has not finished yet. */
	static readonly UNFINISHED_TASK_STATUSES = ["pending", "running", "paused"] as const;

	/** Requests with their package, release, OS release and the people involved joined. */
	static selectRequests(db: DrizzleDB = DB.instance()) {
		const requester = alias(DB.Tables.users, "requester");
		const reviewer = alias(DB.Tables.users, "reviewer");
		const requests = DB.Tables.stablePromotionRequests;
		const messages = DB.Tables.stablePromotionRequestMessages;

		return db
			.select({
				id: requests.id,
				package_id: requests.package_id,
				package_release_id: requests.package_release_id,
				status: requests.status,
				created_at: requests.created_at,
				status_changed_at: requests.status_changed_at,
				os_release_version: DB.Tables.os_releases.version,

				publisher_id: DB.Tables.packagesFullView.publisher_id,
				package_name: DB.Tables.packagesFullView.name,
				package_fullname: DB.Tables.packagesFullView.fullname,
				package_display_name: DB.Tables.packagesFullView.display_name,
				package_latest_stable_release: DB.Tables.packagesFullView.latest_stable_release,
				package_release_version: DB.Tables.packageReleases.version_with_leios_patch,
				package_release_architectures: DB.Tables.packageReleases.architectures,
				package_release_created_at: DB.Tables.packageReleases.created_at,
				package_release_changelog: DB.Tables.packageReleases.changelog,

				requested_by_user_id: requests.requested_by_user_id,
				requested_by_username: requester.username,
				status_changed_by_user_id: requests.status_changed_by_user_id,
				status_changed_by_username: reviewer.username,

				comment_count: sql<number>`(select count(*) from ${messages} where ${messages.request_id} = ${requests.id} and ${messages.kind} = 'comment')`,
				last_message_at: sql<
					number | null
				>`(select max(${messages.created_at}) from ${messages} where ${messages.request_id} = ${requests.id})`,
			})
			.from(requests)
			.innerJoin(DB.Tables.packagesFullView, eq(DB.Tables.packagesFullView.id, requests.package_id))
			.innerJoin(
				DB.Tables.packageReleases,
				eq(DB.Tables.packageReleases.id, requests.package_release_id),
			)
			.leftJoin(DB.Tables.os_releases, eq(DB.Tables.os_releases.id, requests.os_release_id))
			.leftJoin(requester, eq(requester.id, requests.requested_by_user_id))
			.leftJoin(reviewer, eq(reviewer.id, requests.status_changed_by_user_id))
			.$dynamic();
	}

	static async getRequest(id: number, db: DrizzleDB = DB.instance()) {
		return await this.selectRequests(db).where(eq(DB.Tables.stablePromotionRequests.id, id)).get();
	}

	/**
	 * Adds each release's stable promotion (request id, status and OS release) as
	 * `stable_promotion`, or null for releases without a request.
	 */
	static async withStablePromotion<T extends { id: number }>(releases: T[]) {
		const requests = DB.Tables.stablePromotionRequests;
		const rows =
			releases.length === 0
				? []
				: await DB.instance()
						.select({
							request_id: requests.id,
							package_release_id: requests.package_release_id,
							status: requests.status,
							os_release_version: DB.Tables.os_releases.version,
						})
						.from(requests)
						.leftJoin(DB.Tables.os_releases, eq(DB.Tables.os_releases.id, requests.os_release_id))
						.where(
							inArray(
								requests.package_release_id,
								releases.map((release) => release.id),
							),
						);

		const byRelease = new Map(
			rows.map(({ package_release_id, ...row }) => [package_release_id, row]),
		);
		return releases.map((release) => ({
			...release,
			stable_promotion: byRelease.get(release.id) ?? null,
		}));
	}

	/** The conversation of a request, oldest first. */
	static async getMessages(requestID: number, db: DrizzleDB = DB.instance()) {
		const messages = DB.Tables.stablePromotionRequestMessages;
		return await db
			.select({
				id: messages.id,
				request_id: messages.request_id,
				kind: messages.kind,
				status: messages.status,
				body: messages.body,
				created_at: messages.created_at,
				author_user_id: messages.author_user_id,
				author_username: DB.Tables.users.username,
				author_display_name: DB.Tables.users.display_name,
				author_role: DB.Tables.users.role,
			})
			.from(messages)
			.leftJoin(DB.Tables.users, eq(DB.Tables.users.id, messages.author_user_id))
			.where(eq(messages.request_id, requestID))
			// ids follow insertion order; created_at of migrated entries is only approximate
			.orderBy(asc(messages.id));
	}

	static async addComment(
		params: { requestID: number; author: AuthHandler.AuthenticatedAuthContext; body: string },
		db: DrizzleDB = DB.instance(),
	) {
		return await db
			.insert(DB.Tables.stablePromotionRequestMessages)
			.values({
				request_id: params.requestID,
				author_user_id: params.author.user_id,
				kind: "comment",
				body: params.body,
				created_at: Date.now(),
			})
			.returning({ id: DB.Tables.stablePromotionRequestMessages.id })
			.get();
	}

	/**
	 * Sets a request's status and records the change (with the optional comment) in its
	 * conversation and the audit log, atomically.
	 */
	static async changeStatus(params: {
		request: { id: number; package_fullname: string; package_release_version: string };
		status: StablePromotionSettings.Status;
		actor: AuthHandler.AuthenticatedAuthContext;
		message?: string;
	}) {
		const { request, status, actor } = params;
		const now = Date.now();

		await DB.instance().transaction(async (tx) => {
			await tx
				.update(DB.Tables.stablePromotionRequests)
				.set({
					status,
					status_changed_at: now,
					status_changed_by_user_id: actor.user_id,
				})
				.where(eq(DB.Tables.stablePromotionRequests.id, request.id));

			await tx.insert(DB.Tables.stablePromotionRequestMessages).values({
				request_id: request.id,
				author_user_id: actor.user_id,
				kind: "status_change",
				status,
				body: params.message ?? "",
				created_at: now,
			});

			await AuditLog.record(
				{
					actor,
					action: "stable_request.status_change",
					targetType: "stable_promotion_request",
					targetID: request.id,
					targetLabel: `${request.package_fullname} ${request.package_release_version}`,
					metadata: { status, note: params.message ?? null },
				},
				tx,
			);
		});
	}

	/**
	 * The OS release that is still being published with one of these package releases in it, if
	 * any. Its requests must keep their status until it finishes.
	 */
	static async getPublishingOSRelease(packageReleaseIDs: number[], db: DrizzleDB = DB.instance()) {
		if (packageReleaseIDs.length === 0) return undefined;

		return await db
			.select({ version: DB.Tables.os_releases.version })
			.from(DB.Tables.osReleasePackages)
			.innerJoin(
				DB.Tables.os_releases,
				eq(DB.Tables.os_releases.id, DB.Tables.osReleasePackages.os_release_id),
			)
			.innerJoin(
				DB.Tables.scheduled_tasks,
				eq(DB.Tables.scheduled_tasks.id, DB.Tables.os_releases.taskID),
			)
			.where(
				and(
					inArray(DB.Tables.osReleasePackages.package_release_id, packageReleaseIDs),
					inArray(DB.Tables.scheduled_tasks.status, [...StablePromotion.UNFINISHED_TASK_STATUSES]),
				),
			)
			.get();
	}

	/**
	 * Marks the queued requests of the given package releases as released with an OS release and
	 * adds a note to their conversations. Called by the OS release task when it finishes.
	 */
	static async markReleased(params: { packageReleaseIDs: number[]; osReleaseVersion: string }) {
		const { packageReleaseIDs, osReleaseVersion } = params;
		if (packageReleaseIDs.length === 0) return;

		const now = Date.now();

		await DB.instance().transaction(async (tx) => {
			const osRelease = await tx
				.select({ id: DB.Tables.os_releases.id })
				.from(DB.Tables.os_releases)
				.where(eq(DB.Tables.os_releases.version, osReleaseVersion))
				.get();

			const released = await tx
				.update(DB.Tables.stablePromotionRequests)
				.set({
					status: "released",
					os_release_id: osRelease?.id ?? null,
					status_changed_at: now,
					status_changed_by_user_id: null,
				})
				.where(
					and(
						inArray(DB.Tables.stablePromotionRequests.package_release_id, packageReleaseIDs),
						eq(DB.Tables.stablePromotionRequests.status, "queued"),
					),
				)
				.returning({ id: DB.Tables.stablePromotionRequests.id });

			if (released.length > 0) {
				await tx.insert(DB.Tables.stablePromotionRequestMessages).values(
					released.map((request) => ({
						request_id: request.id,
						author_user_id: null,
						kind: "status_change" as const,
						status: "released" as const,
						body: `Moved into stable with LeiOS ${osReleaseVersion}.`,
						created_at: now,
					})),
				);
			}
		});
	}

	/** Deletes requests with their conversations (SQLite foreign keys are not always enforced). */
	static async deleteRequests(
		where: { packageReleaseID: number } | { packageID: number } | { requestID: number },
		tx: DrizzleDB = DB.instance(),
	) {
		const requests = DB.Tables.stablePromotionRequests;
		const condition =
			"requestID" in where
				? eq(requests.id, where.requestID)
				: "packageReleaseID" in where
					? eq(requests.package_release_id, where.packageReleaseID)
					: eq(requests.package_id, where.packageID);

		const ids = (await tx.select({ id: requests.id }).from(requests).where(condition)).map(
			(row) => row.id,
		);
		if (ids.length === 0) return;

		await tx
			.delete(DB.Tables.stablePromotionRequestMessages)
			.where(inArray(DB.Tables.stablePromotionRequestMessages.request_id, ids));
		await tx.delete(requests).where(inArray(requests.id, ids));
	}
}
