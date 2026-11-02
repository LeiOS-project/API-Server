import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../../db";
import { PermissionHelper } from "../../../../../../../utils/permission-helper";
import { APIResponse } from "../../../../../../utils/api-res";
import { AuditLog } from "../../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../../utils/authHandler";
import { APIResponseSpec, APIRouteSpec } from "../../../../../../utils/specHelpers";
import { StablePromotion } from "../../../../../../utils/stablePromotion";
import { DOCS_TAGS } from "../../../../docs";
import { StablePromotionRequestsModel } from "./model";

type StablePromotionRequest = NonNullable<Awaited<ReturnType<typeof StablePromotion.getRequest>>>;

/** Per-request values loaded by the parameter middlewares (this router's or a parent's). */
type Variables = {
	package: DB.Models.PackageFullView;
	release: DB.Models.PackageRelease;
	stablePromotionRequest: StablePromotionRequest;
};

export const router = new Hono<{ Variables: Variables }>().basePath("/stable-promotion-requests");

const toEntity = (request: StablePromotionRequest) =>
	StablePromotionRequestsModel.Entity.parse(request);

/** Anyone with a role in the package (or its publisher) and site staff can read the conversation. */
async function canReadConversation(
	authContext: AuthHandler.AuthContext,
	pkg: DB.Models.PackageFullView,
) {
	if (PermissionHelper.isSiteStaff(authContext)) return true;
	return await PermissionHelper.can({
		authContext,
		publisherId: pkg.publisher_id,
		packageId: pkg.id,
		check: () => true,
	});
}

/** Members who may request stable promotions, and site staff, can write in the conversation. */
async function canWriteConversation(
	authContext: AuthHandler.AuthContext,
	pkg: DB.Models.PackageFullView,
) {
	if (PermissionHelper.isSiteStaff(authContext)) return true;
	return await PermissionHelper.can({
		authContext,
		publisherId: pkg.publisher_id,
		packageId: pkg.id,
		check: (p) => p.packages.releases.requestStable,
	});
}

router.get(
	"/",

	APIRouteSpec.unauthenticated({
		summary: "List stable promotion requests for a release",
		description:
			"Retrieve the stable promotion requests of the specified release (at most one) with their status: pending (waiting for review), queued (approved, waits for the next OS release), released or denied.",
		operationId: "listReleaseStablePromotionRequests",
		tags: [DOCS_TAGS.PACKAGES_STABLE_REQUESTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Stable promotion requests retrieved successfully",
				StablePromotionRequestsModel.GetAll.Response,
			),
		),
	}),

	zValidator("query", StablePromotionRequestsModel.GetAll.Query),

	async (c) => {
		const release = c.get("release");
		const filters = c.req.valid("query");

		const requests = await StablePromotion.selectRequests().where(
			and(
				eq(DB.Tables.stablePromotionRequests.package_release_id, release.id),
				filters.status ? eq(DB.Tables.stablePromotionRequests.status, filters.status) : undefined,
			),
		);

		return APIResponse.success(
			c,
			"Stable promotion requests retrieved successfully",
			requests.map(toEntity) satisfies StablePromotionRequestsModel.GetAll.Response,
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create a stable promotion request for a release",
		description:
			"Submit a request for the specified release to be promoted to stable, optionally with a message for the reviewers. Requires packages.releases.requestStable permission.",
		operationId: "createReleaseStablePromotionRequest",
		tags: [DOCS_TAGS.PACKAGES_STABLE_REQUESTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created(
				"Stable promotion request submitted",
				StablePromotionRequestsModel.Create.Response,
			),
			APIResponseSpec.forbidden(
				"You do not have permission to request stable promotions for this package",
			),
			APIResponseSpec.conflict(
				"A request already exists for this release or the release is already stable",
			),
			APIResponseSpec.badRequest(
				"The release must have at least one uploaded .deb package before requesting stable promotion",
			),
		),
	}),

	zValidator("json", StablePromotionRequestsModel.Create.Body),

	async (c) => {
		const pkg = c.get("package");
		const release = c.get("release");
		const authContext = AuthHandler.AuthContext.get(c);
		const { message } = c.req.valid("json");

		const allowed = await PermissionHelper.can({
			authContext,
			publisherId: pkg.publisher_id,
			packageId: pkg.id,
			check: (p) => p.packages.releases.requestStable,
		});

		if (!allowed || authContext.type === "unauthenticated") {
			return APIResponse.forbidden(
				c,
				"You do not have permission to request stable promotions for this package",
			);
		}

		const architectures = release.architectures;
		if (!architectures.amd64 && !architectures.arm64 && !architectures.is_all) {
			return APIResponse.badRequest(
				c,
				"The release must have at least one uploaded .deb package before requesting stable promotion",
			);
		}

		const alreadyExists = await DB.instance()
			.select({ id: DB.Tables.stablePromotionRequests.id })
			.from(DB.Tables.stablePromotionRequests)
			.where(eq(DB.Tables.stablePromotionRequests.package_release_id, release.id))
			.get();

		if (alreadyExists) {
			return APIResponse.conflict(
				c,
				"A request already exists for this release or the release is already stable",
			);
		}

		const result = await DB.instance().transaction(async (tx) => {
			const created = await tx
				.insert(DB.Tables.stablePromotionRequests)
				.values({
					package_id: pkg.id,
					package_release_id: release.id,
					status: "pending",
					requested_by_user_id: authContext.user_id,
				})
				.returning()
				.get();

			if (message) {
				await StablePromotion.addComment(
					{ requestID: created.id, author: authContext, body: message },
					tx,
				);
			}

			await AuditLog.record(
				{
					actor: authContext,
					action: "stable_request.create",
					targetType: "stable_promotion_request",
					targetID: created.id,
					targetLabel: `${pkg.fullname} ${release.version_with_leios_patch}`,
				},
				tx,
			);

			return created;
		});

		return APIResponse.created(c, "Stable promotion request submitted", {
			id: result.id,
		} satisfies StablePromotionRequestsModel.Create.Response);
	},
);

router.use(
	"/:stablePromotionRequestID/*",

	zValidator("param", StablePromotionRequestsModel.Param),

	async (c, next) => {
		// @ts-expect-error - hono-openapi's validator does not type "param" yet
		const { stablePromotionRequestID } = c.req.valid("param") as StablePromotionRequestsModel.Param;
		const release = c.get("release");

		const request = await StablePromotion.getRequest(stablePromotionRequestID);

		if (!request || request.package_release_id !== release.id) {
			return APIResponse.notFound(c, "Stable promotion request not found for this release");
		}

		c.set("stablePromotionRequest", request);

		return await next();
	},
);

router.get(
	"/:stablePromotionRequestID",

	APIRouteSpec.unauthenticated({
		summary: "Get a stable promotion request for a release",
		description: "Retrieve details of a specific stable promotion request for the specified release.",
		operationId: "getReleaseStablePromotionRequest",
		tags: [DOCS_TAGS.PACKAGES_STABLE_REQUESTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Stable promotion request retrieved successfully",
				StablePromotionRequestsModel.GetByID.Response,
			),
			APIResponseSpec.notFound("Stable promotion request not found for this release"),
		),
	}),

	async (c) => {
		const request = c.get("stablePromotionRequest");
		return APIResponse.success(
			c,
			"Stable promotion request retrieved successfully",
			toEntity(request) satisfies StablePromotionRequestsModel.GetByID.Response,
		);
	},
);

router.delete(
	"/:stablePromotionRequestID",

	APIRouteSpec.authenticated({
		summary: "Withdraw a stable promotion request for a release",
		description:
			"Withdraw (delete) a stable promotion request together with its conversation; a queued release leaves the stable queue. Released requests stay as history. Requires packages.releases.requestStable permission.",
		operationId: "deleteReleaseStablePromotionRequest",
		tags: [DOCS_TAGS.PACKAGES_STABLE_REQUESTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Stable promotion request deleted successfully"),
			APIResponseSpec.forbidden(
				"You do not have permission to delete stable promotion requests for this package",
			),
			APIResponseSpec.conflict(
				"The release is already in stable / The release is being published with an OS release",
			),
		),
	}),

	async (c) => {
		const pkg = c.get("package");
		const authContext = AuthHandler.AuthContext.get(c);
		const request = c.get("stablePromotionRequest");

		const allowed = await PermissionHelper.can({
			authContext,
			publisherId: pkg.publisher_id,
			packageId: pkg.id,
			check: (p) => p.packages.releases.requestStable,
		});

		if (!allowed) {
			return APIResponse.forbidden(
				c,
				"You do not have permission to delete stable promotion requests for this package",
			);
		}

		if (request.status === "released") {
			return APIResponse.conflict(c, "The release is already in stable");
		}

		const publishing = await StablePromotion.getPublishingOSRelease([request.package_release_id]);
		if (publishing) {
			return APIResponse.conflict(
				c,
				`The release is being published with LeiOS ${publishing.version}`,
			);
		}

		await DB.instance().transaction(async (tx) => {
			await StablePromotion.deleteRequests({ requestID: request.id }, tx);

			await AuditLog.record(
				{
					actor: authContext,
					action: "stable_request.withdraw",
					targetType: "stable_promotion_request",
					targetID: request.id,
					targetLabel: `${pkg.fullname} ${request.package_release_version}`,
					metadata: { status: request.status },
				},
				tx,
			);
		});

		return APIResponse.successNoData(c, "Stable promotion request deleted successfully");
	},
);

router.get(
	"/:stablePromotionRequestID/messages",

	APIRouteSpec.authenticated({
		summary: "Get the conversation of a stable promotion request",
		description:
			"Comments and status changes of the request, oldest first. Visible to the package's publisher members and site staff.",
		operationId: "listReleaseStablePromotionRequestMessages",
		tags: [DOCS_TAGS.PACKAGES_STABLE_REQUESTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Messages retrieved successfully",
				StablePromotionRequestsModel.GetMessages.Response,
			),
			APIResponseSpec.forbidden("Only members of the publisher can read this conversation"),
			APIResponseSpec.notFound("Stable promotion request not found for this release"),
		),
	}),

	async (c) => {
		const pkg = c.get("package");
		const request = c.get("stablePromotionRequest");
		const authContext = AuthHandler.AuthContext.get(c);

		if (authContext.type === "unauthenticated") {
			return APIResponse.unauthorized(c, "Authentication required");
		}
		if (!(await canReadConversation(authContext, pkg))) {
			return APIResponse.forbidden(c, "Only members of the publisher can read this conversation");
		}

		const messages = await StablePromotion.getMessages(request.id);

		return APIResponse.success(
			c,
			"Messages retrieved successfully",
			messages satisfies StablePromotionRequestsModel.GetMessages.Response,
		);
	},
);

router.post(
	"/:stablePromotionRequestID/messages",

	APIRouteSpec.authenticated({
		summary: "Reply to a stable promotion request",
		description:
			"Add a comment (Markdown) to the request's conversation. Requires packages.releases.requestStable permission or a site staff role. Released requests are closed.",
		operationId: "createReleaseStablePromotionRequestMessage",
		tags: [DOCS_TAGS.PACKAGES_STABLE_REQUESTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Message added", StablePromotionRequestsModel.CreateMessage.Response),
			APIResponseSpec.forbidden("You do not have permission to reply to this request"),
			APIResponseSpec.conflict("The request was released; its conversation is closed"),
			APIResponseSpec.notFound("Stable promotion request not found for this release"),
		),
	}),

	zValidator("json", StablePromotionRequestsModel.CreateMessage.Body),

	async (c) => {
		const pkg = c.get("package");
		const request = c.get("stablePromotionRequest");
		const authContext = AuthHandler.AuthContext.get(c);
		const { body } = c.req.valid("json");

		if (authContext.type === "unauthenticated") {
			return APIResponse.unauthorized(c, "Authentication required");
		}
		if (!(await canWriteConversation(authContext, pkg))) {
			return APIResponse.forbidden(c, "You do not have permission to reply to this request");
		}

		if (request.status === "released") {
			return APIResponse.conflict(c, "The request was released; its conversation is closed");
		}

		const message = await StablePromotion.addComment({
			requestID: request.id,
			author: authContext,
			body,
		});

		return APIResponse.created(
			c,
			"Message added",
			message satisfies StablePromotionRequestsModel.CreateMessage.Response,
		);
	},
);
