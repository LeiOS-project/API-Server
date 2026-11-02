import { and, asc, desc, eq, inArray, like, or } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { AuthHandler } from "../../../../../utils/authHandler";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { StablePromotion } from "../../../../../utils/stablePromotion";
import { DOCS_TAGS } from "../../../docs";
import { AdminStablePromotionRequestModel } from "./model";

type StablePromotionRequest = NonNullable<Awaited<ReturnType<typeof StablePromotion.getRequest>>>;

/** Per-request values loaded by the parameter middlewares (this router's or a parent's). */
type Variables = {
	stablePromotionRequest: StablePromotionRequest;
};

export const router = new Hono<{ Variables: Variables }>().basePath("/stable-promotion-requests");

const toEntity = (request: StablePromotionRequest) =>
	AdminStablePromotionRequestModel.Entity.parse(request);

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List stable promotion requests",
		description:
			"Retrieve stable promotion requests, filtered by status and package. `status=queued` lists the stable queue: the releases the next OS release can include.",
		tags: [DOCS_TAGS.ADMIN_STABLE_PROMOTION_REQUESTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"Stable promotion requests retrieved successfully",
				AdminStablePromotionRequestModel.GetAll.Response,
			),
		),
	}),

	zValidator("query", AdminStablePromotionRequestModel.GetAll.Query),

	async (c) => {
		const { limit, offset, order, status, search } = c.req.valid("query");
		const requests = DB.Tables.stablePromotionRequests;

		// The search runs on joined columns, so match ids first and count/filter by those.
		const searchIDs = search
			? (
					await DB.instance()
						.select({ id: requests.id })
						.from(requests)
						.innerJoin(DB.Tables.packagesFullView, eq(DB.Tables.packagesFullView.id, requests.package_id))
						.innerJoin(
							DB.Tables.packageReleases,
							eq(DB.Tables.packageReleases.id, requests.package_release_id),
						)
						.where(
							or(
								like(DB.Tables.packagesFullView.fullname, `%${search}%`),
								like(DB.Tables.packagesFullView.display_name, `%${search}%`),
								like(DB.Tables.packageReleases.version_with_leios_patch, `%${search}%`),
							),
						)
				).map((row) => row.id)
			: undefined;

		const where = and(
			status ? eq(requests.status, status) : undefined,
			searchIDs ? inArray(requests.id, searchIDs) : undefined,
		);

		const items = await StablePromotion.selectRequests()
			.where(where)
			.orderBy(
				order === "newest" ? desc(requests.created_at) : asc(requests.created_at),
				order === "newest" ? desc(requests.id) : asc(requests.id),
			)
			.limit(limit)
			.offset(offset);

		const total = await DB.instance().$count(requests, where);

		return APIResponse.success(c, "Stable promotion requests retrieved successfully", {
			items: items.map(toEntity),
			total,
		} satisfies AdminStablePromotionRequestModel.GetAll.Response);
	},
);

router.use(
	"/:stablePromotionRequestID/*",

	zValidator("param", AdminStablePromotionRequestModel.Param),

	async (c, next) => {
		// @ts-expect-error - hono-openapi's validator does not type "param" yet
		const { stablePromotionRequestID } = c.req.valid("param") as { stablePromotionRequestID: number };

		const request = await StablePromotion.getRequest(stablePromotionRequestID);

		if (!request) {
			return APIResponse.notFound(c, "Stable promotion request not found");
		}

		c.set("stablePromotionRequest", request);

		await next();
	},
);

router.get(
	"/:stablePromotionRequestID",

	APIRouteSpec.authenticated({
		summary: "Get stable promotion request details",
		description: "Retrieve details of a specific stable promotion request.",
		tags: [DOCS_TAGS.ADMIN_STABLE_PROMOTION_REQUESTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Stable promotion request retrieved successfully",
				AdminStablePromotionRequestModel.GetById.Response,
			),
			APIResponseSpec.notFound("Stable promotion request not found"),
		),
	}),

	async (c) => {
		return APIResponse.success(
			c,
			"Stable promotion request retrieved successfully",
			toEntity(
				c.get("stablePromotionRequest"),
			) satisfies AdminStablePromotionRequestModel.GetById.Response,
		);
	},
);

router.put(
	"/:stablePromotionRequestID/status",

	APIRouteSpec.authenticated({
		summary: "Change the status of a stable promotion request",
		description:
			"Queue (approve) a release for the next OS release, deny it, or set it back to pending (reopen a denied request or take a queued one out of the queue). The change and the optional comment appear in the request's conversation.",
		tags: [DOCS_TAGS.ADMIN_STABLE_PROMOTION_REQUESTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Status changed successfully"),
			APIResponseSpec.conflict(
				"The request already has this status / The release is already in stable / The release is being published with an OS release",
			),
			APIResponseSpec.notFound("Stable promotion request not found"),
		),
	}),

	zValidator("json", AdminStablePromotionRequestModel.ChangeStatus.Body),

	async (c) => {
		const request = c.get("stablePromotionRequest");
		const authContext = AuthHandler.AuthContext.getAsAuthenticated(c);
		const { status, message } = c.req.valid("json");

		if (request.status === "released") {
			return APIResponse.conflict(c, "The release is already in stable");
		}
		if (request.status === status) {
			return APIResponse.conflict(c, `The request is already ${status}`);
		}

		const publishing = await StablePromotion.getPublishingOSRelease([request.package_release_id]);
		if (publishing) {
			return APIResponse.conflict(
				c,
				`The release is being published with LeiOS ${publishing.version}`,
			);
		}

		await StablePromotion.changeStatus({ request, status, actor: authContext, message });

		return APIResponse.successNoData(c, "Status changed successfully");
	},
);

router.get(
	"/:stablePromotionRequestID/messages",

	APIRouteSpec.authenticated({
		summary: "Get the conversation of a stable promotion request",
		description: "Comments and status changes of the request, oldest first.",
		tags: [DOCS_TAGS.ADMIN_STABLE_PROMOTION_REQUESTS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Messages retrieved successfully",
				AdminStablePromotionRequestModel.GetMessages.Response,
			),
			APIResponseSpec.notFound("Stable promotion request not found"),
		),
	}),

	async (c) => {
		const messages = await StablePromotion.getMessages(c.get("stablePromotionRequest").id);

		return APIResponse.success(
			c,
			"Messages retrieved successfully",
			messages satisfies AdminStablePromotionRequestModel.GetMessages.Response,
		);
	},
);

router.post(
	"/:stablePromotionRequestID/messages",

	APIRouteSpec.authenticated({
		summary: "Reply to a stable promotion request",
		description:
			"Add a comment (Markdown) to the request's conversation. Released requests are closed.",
		tags: [DOCS_TAGS.ADMIN_STABLE_PROMOTION_REQUESTS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created(
				"Message added",
				AdminStablePromotionRequestModel.CreateMessage.Response,
			),
			APIResponseSpec.conflict("The request was released; its conversation is closed"),
			APIResponseSpec.notFound("Stable promotion request not found"),
		),
	}),

	zValidator("json", AdminStablePromotionRequestModel.CreateMessage.Body),

	async (c) => {
		const request = c.get("stablePromotionRequest");
		const { body } = c.req.valid("json");

		if (request.status === "released") {
			return APIResponse.conflict(c, "The request was released; its conversation is closed");
		}

		const message = await StablePromotion.addComment({
			requestID: request.id,
			author: AuthHandler.AuthContext.getAsAuthenticated(c),
			body,
		});

		return APIResponse.created(
			c,
			"Message added",
			message satisfies AdminStablePromotionRequestModel.CreateMessage.Response,
		);
	},
);
