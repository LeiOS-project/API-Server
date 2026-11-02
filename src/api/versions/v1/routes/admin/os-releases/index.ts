import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { TaskQueueUtils } from "../../../../../../tasks";
import { TaskUtils } from "../../../../../../tasks/utils";
import { ConfigHandler } from "../../../../../../utils/config";
import { PermissionHelper } from "../../../../../../utils/permission-helper";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { OSReleaseUtils } from "../../../../../utils/os-release-utils";
import { ApiHelperModels } from "../../../../../utils/shared-models/api-helper-models";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { StablePromotion } from "../../../../../utils/stablePromotion";
import { DOCS_TAGS } from "../../../docs";
import { OSReleasesModel } from "./model";

/** Per-request values loaded by the parameter middlewares (this router's or a parent's). */
type Variables = {
	osRelease: DB.Models.OSRelease;
};

export const router = new Hono<{ Variables: Variables }>().basePath("/os-releases");

// Moderators can follow OS releases; creating and editing them is for admins.
const ADMIN_ONLY_MESSAGE = "Only site administrators can create or edit OS releases";

const osReleases = DB.Tables.os_releases;

/** OS releases with their publishing task's state and how many package releases they include. */
function selectOSReleases() {
	return DB.instance()
		.select({
			id: osReleases.id,
			version: osReleases.version,
			changelog: osReleases.changelog,
			created_at: osReleases.created_at,

			published_at: DB.Tables.scheduled_tasks.finished_at,
			publishing_status: DB.Tables.scheduled_tasks.status,
			package_count: sql<number>`(select count(*) from ${DB.Tables.osReleasePackages} where ${DB.Tables.osReleasePackages.os_release_id} = ${osReleases.id})`,
		})
		.from(osReleases)
		.innerJoin(DB.Tables.scheduled_tasks, eq(DB.Tables.scheduled_tasks.id, osReleases.taskID))
		.$dynamic();
}

async function getPackages(osReleaseID: number) {
	return await DB.instance()
		.select({
			package_release_id: DB.Tables.osReleasePackages.package_release_id,
			package_fullname: DB.Tables.osReleasePackages.package_fullname,
			version_with_leios_patch: DB.Tables.osReleasePackages.version_with_leios_patch,
		})
		.from(DB.Tables.osReleasePackages)
		.where(eq(DB.Tables.osReleasePackages.os_release_id, osReleaseID))
		.orderBy(asc(DB.Tables.osReleasePackages.id));
}

/** The version the next OS release gets: YYYY.MM.NNN, counting up within a month. */
async function getNextVersion(now: Date) {
	const lastRelease = await DB.instance()
		.select({ version: osReleases.version })
		.from(osReleases)
		.orderBy(desc(osReleases.created_at), desc(osReleases.id))
		.limit(1)
		.get();

	return OSReleaseUtils.getVersionString(now, lastRelease?.version ?? "0000.00.000");
}

/**
 * Loads the given stable promotion requests, which must all be queued, in the order the OS
 * release moves them into stable: oldest release first, so a newer release of the same package
 * replaces an older one.
 */
async function loadQueuedRequests(requestIDs: number[]) {
	if (requestIDs.length === 0) return { requests: [], notQueued: [] };

	const requests = await StablePromotion.selectRequests()
		.where(inArray(DB.Tables.stablePromotionRequests.id, requestIDs))
		.orderBy(asc(DB.Tables.packageReleases.created_at), asc(DB.Tables.packageReleases.id));

	const queued = requests.filter((request) => request.status === "queued");
	const queuedIDs = new Set(queued.map((request) => request.id));
	return { requests: queued, notQueued: requestIDs.filter((id) => !queuedIDs.has(id)) };
}

function toChangelogEntries(
	requests: Awaited<ReturnType<typeof loadQueuedRequests>>["requests"],
): OSReleaseUtils.ChangelogEntry[] {
	return requests.map((request) => ({
		package_fullname: request.package_fullname,
		package_display_name: request.package_display_name,
		package_release_version: request.package_release_version,
		previous_stable_version:
			request.package_latest_stable_release.amd64 ?? request.package_latest_stable_release.arm64,
		release_changelog: request.package_release_changelog,
	}));
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List OS releases",
		description: "Retrieve all OS releases.",
		tags: [DOCS_TAGS.ADMIN_OS_RELEASES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("OS releases retrieved", OSReleasesModel.GetAll.Response),
		),
	}),

	zValidator("query", ApiHelperModels.ListAll.Query),

	async (c) => {
		const { limit, offset, order } = c.req.valid("query");

		const items = await selectOSReleases()
			.orderBy(order === "newest" ? desc(osReleases.created_at) : asc(osReleases.created_at))
			.limit(limit)
			.offset(offset);

		const total = await DB.instance().$count(osReleases);

		return APIResponse.success(c, "OS releases retrieved", {
			items,
			total,
		} satisfies OSReleasesModel.GetAll.Response);
	},
);

router.post(
	"/generate-changelog",

	APIRouteSpec.authenticated({
		summary: "Generate OS release notes",
		description:
			"Generate Markdown release notes for an OS release with the given queued stable promotion requests, and the version it would get. Changes nothing.",
		tags: [DOCS_TAGS.ADMIN_OS_RELEASES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Release notes generated", OSReleasesModel.GenerateChangelog.Response),
			APIResponseSpec.badRequest("Only queued stable promotion requests can be included"),
		),
	}),

	zValidator("json", OSReleasesModel.GenerateChangelog.Body),

	async (c) => {
		const { stable_promotion_request_ids } = c.req.valid("json");

		const { requests, notQueued } = await loadQueuedRequests(stable_promotion_request_ids);
		if (notQueued.length > 0) {
			return APIResponse.badRequest(
				c,
				`Only queued stable promotion requests can be included (not queued: ${notQueued.map((id) => `#${id}`).join(", ")})`,
			);
		}

		return APIResponse.success(c, "Release notes generated", {
			version: await getNextVersion(new Date()),
			changelog: OSReleaseUtils.generateChangelog(
				toChangelogEntries(requests),
				ConfigHandler.getConfig()?.HUB_URL,
			),
		} satisfies OSReleasesModel.GenerateChangelog.Response);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create OS release (async)",
		description:
			"Enqueue an OS release that moves the selected queued releases into stable and publishes the live repo. Pick any subset of the stable queue, for example only a security fix. Admins only.",
		tags: [DOCS_TAGS.ADMIN_OS_RELEASES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.accepted(
				"OS release creation task enqueued",
				OSReleasesModel.CreateRelease.Response,
			),
			APIResponseSpec.badRequest("Only queued stable promotion requests can be included"),
			APIResponseSpec.forbidden(ADMIN_ONLY_MESSAGE),
			APIResponseSpec.conflict("Another OS release is still being published"),
		),
	}),

	zValidator("json", OSReleasesModel.CreateRelease.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		if (!PermissionHelper.isSiteAdmin(authContext)) {
			return APIResponse.forbidden(c, ADMIN_ONLY_MESSAGE);
		}

		const { changelog, stable_promotion_request_ids } = c.req.valid("json");

		// Two OS releases publishing at once would race on the stable repo.
		const publishing = await selectOSReleases()
			.where(inArray(DB.Tables.scheduled_tasks.status, [...StablePromotion.UNFINISHED_TASK_STATUSES]))
			.get();
		if (publishing) {
			return APIResponse.conflict(
				c,
				`LeiOS ${publishing.version} is still being published; wait until it finished`,
			);
		}

		const { requests, notQueued } = await loadQueuedRequests(stable_promotion_request_ids);
		if (notQueued.length > 0) {
			return APIResponse.badRequest(
				c,
				`Only queued stable promotion requests can be included (not queued: ${notQueued.map((id) => `#${id}`).join(", ")})`,
			);
		}

		const now = new Date();
		const version = await getNextVersion(now);

		const taskID = await TaskQueueUtils.createPendingTaskRecord(
			"os-release:create",
			{
				pkgReleasesToIncludeByID: requests.map((request) => request.package_release_id),
				version,
				timestamp: now.getTime(),
				changelogLines: OSReleaseUtils.toPlainLines(changelog),
			},
			{
				created_by_user_id: authContext.type === "unauthenticated" ? null : authContext.user_id,
			},
			{
				storeLogs: true,
			},
		);

		let created: DB.Models.OSRelease;
		try {
			created = await DB.instance().transaction(async (tx) => {
				const osRelease = await tx
					.insert(osReleases)
					.values({ version, changelog, taskID })
					.returning()
					.get();

				if (requests.length > 0) {
					await tx.insert(DB.Tables.osReleasePackages).values(
						requests.map((request) => ({
							os_release_id: osRelease.id,
							package_release_id: request.package_release_id,
							package_fullname: request.package_fullname,
							version_with_leios_patch: request.package_release_version,
						})),
					);
				}

				await AuditLog.record(
					{
						actor: authContext,
						action: "os_release.create",
						targetType: "os_release",
						targetID: osRelease.id,
						targetLabel: version,
						metadata: {
							task_id: taskID,
							stable_promotion_request_ids: requests.map((request) => request.id),
						},
					},
					tx,
				);

				return osRelease;
			});
		} catch (error) {
			await TaskQueueUtils.deleteTaskRecord(taskID);
			throw error;
		}

		await TaskQueueUtils.activatePendingTask(taskID);

		const { taskID: _taskID, ...release } = created;

		return APIResponse.accepted(c, "OS release creation task enqueued", {
			...release,
			published_at: null,
			publishing_status: "pending",
			package_count: requests.length,
			packages: await getPackages(created.id),
		} satisfies OSReleasesModel.CreateRelease.Response);
	},
);

router.use(
	"/:version/*",

	zValidator("param", OSReleasesModel.Param),

	async (c, next) => {
		// @ts-expect-error - hono-openapi's validator does not type "param" yet
		const { version } = c.req.valid("param") as { version: string };

		const release = await DB.instance()
			.select()
			.from(osReleases)
			.where(eq(osReleases.version, version))
			.get();

		if (!release) {
			return APIResponse.notFound(c, "OS release not found");
		}

		c.set("osRelease", release);

		await next();
	},
);

router.get(
	"/:version",

	APIRouteSpec.authenticated({
		summary: "Get OS release",
		description: "Retrieve a specific OS release by version, with the package releases it includes.",
		tags: [DOCS_TAGS.ADMIN_OS_RELEASES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("OS release retrieved", OSReleasesModel.GetByVersion.Response),
			APIResponseSpec.notFound("OS release not found"),
		),
	}),

	async (c) => {
		const osRelease = c.get("osRelease");

		const release = await selectOSReleases().where(eq(osReleases.id, osRelease.id)).get();

		if (!release) {
			return APIResponse.serverError(c, "Associated publishing task not found for this OS release");
		}

		return APIResponse.success(c, "OS release retrieved", {
			...release,
			packages: await getPackages(osRelease.id),
		} satisfies OSReleasesModel.GetByVersion.Response);
	},
);

router.get(
	"/:version/publishing-logs",

	APIRouteSpec.authenticated({
		summary: "Get OS release publishing logs",
		description: "Retrieve publishing logs of a specific OS release by version.",
		tags: [DOCS_TAGS.ADMIN_OS_RELEASES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Publishing logs retrieved", OSReleasesModel.GetPublishingLogs.Response),
			APIResponseSpec.notFound(
				"OS release not found / Log file not found for this OS release publishing task",
			),
		),
	}),

	async (c) => {
		const release = c.get("osRelease");

		const logs = await TaskUtils.getLogsForTask(release.taskID);

		if (logs === null) {
			return APIResponse.notFound(c, "Log file not found for this OS release publishing task");
		}

		return APIResponse.success(c, "Publishing logs retrieved", {
			logs,
		} satisfies OSReleasesModel.GetPublishingLogs.Response);
	},
);

router.put(
	"/:version",

	APIRouteSpec.authenticated({
		summary: "Update OS release",
		description: "Update details of a specific OS release by version. Admins only.",
		tags: [DOCS_TAGS.ADMIN_OS_RELEASES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("OS release updated successfully"),
			APIResponseSpec.forbidden(ADMIN_ONLY_MESSAGE),
			APIResponseSpec.notFound("OS release not found"),
		),
	}),

	zValidator("json", OSReleasesModel.UpdateRelease.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		if (!PermissionHelper.isSiteAdmin(authContext)) {
			return APIResponse.forbidden(c, ADMIN_ONLY_MESSAGE);
		}

		const release = c.get("osRelease");
		const updateData = c.req.valid("json");

		if (updateData.changelog !== undefined) {
			await DB.instance()
				.update(osReleases)
				.set({ changelog: updateData.changelog })
				.where(eq(osReleases.id, release.id));
		}

		await AuditLog.record({
			actor: authContext,
			action: "os_release.update",
			targetType: "os_release",
			targetID: release.id,
			targetLabel: release.version,
		});

		return APIResponse.successNoData(c, "OS release updated successfully");
	},
);
