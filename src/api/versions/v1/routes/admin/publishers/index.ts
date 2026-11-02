import { and, asc, eq, isNotNull, isNull, like, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { AdminPublishersModel } from "./model";

export const router = new Hono().basePath("/publishers");

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List all publishers",
		description:
			"Every publisher with its owner and package/member counts, optionally filtered by name or verification.",
		tags: [DOCS_TAGS.ADMIN_PUBLISHERS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"Publishers retrieved successfully",
				AdminPublishersModel.GetAll.Response,
			),
		),
	}),

	zValidator("query", AdminPublishersModel.GetAll.Query),

	async (c) => {
		const { limit, offset, search, verified } = c.req.valid("query");

		const where = and(
			search
				? or(
						like(DB.Tables.publishers.name, `%${search}%`),
						like(DB.Tables.publishers.display_name, `%${search}%`),
					)
				: undefined,
			verified === undefined
				? undefined
				: verified
					? isNotNull(DB.Tables.publishers.verified_at)
					: isNull(DB.Tables.publishers.verified_at),
		);

		const items = await DB.instance()
			.select({
				id: DB.Tables.publishers.id,
				name: DB.Tables.publishers.name,
				display_name: DB.Tables.publishers.display_name,
				description: DB.Tables.publishers.description,
				homepage_url: DB.Tables.publishers.homepage_url,
				owner_user_id: DB.Tables.publishers.owner_user_id,
				created_at: DB.Tables.publishers.created_at,
				maintainer_contact_name: DB.Tables.publishers.maintainer_contact_name,
				maintainer_contact_email: DB.Tables.publishers.maintainer_contact_email,
				verified_at: DB.Tables.publishers.verified_at,

				owner_username: DB.Tables.users.username,
				package_count: sql<number>`(select count(*) from ${DB.Tables.packages} where ${DB.Tables.packages.publisher_id} = ${DB.Tables.publishers.id})`,
				member_count: sql<number>`(select count(*) from ${DB.Tables.publisherMembers} where ${DB.Tables.publisherMembers.publisher_id} = ${DB.Tables.publishers.id})`,
			})
			.from(DB.Tables.publishers)
			.innerJoin(DB.Tables.users, eq(DB.Tables.users.id, DB.Tables.publishers.owner_user_id))
			.where(where)
			.orderBy(asc(DB.Tables.publishers.name))
			.limit(limit)
			.offset(offset);

		const total = await DB.instance().$count(DB.Tables.publishers, where);

		return APIResponse.success(c, "Publishers retrieved successfully", {
			items,
			total,
		} satisfies AdminPublishersModel.GetAll.Response);
	},
);

for (const verify of [true, false]) {
	const action = verify ? "verify" : "unverify";
	const message = verify ? "Publisher marked as verified" : "Publisher verification removed";

	router.post(
		`/:publisherName/${action}`,

		APIRouteSpec.authenticated({
			summary: verify ? "Verify publisher" : "Remove publisher verification",
			description: verify
				? "Mark a publisher as verified (official / trusted). Verified publishers get a badge in the hub."
				: "Remove the verified badge from a publisher.",
			tags: [DOCS_TAGS.ADMIN_PUBLISHERS],

			responses: APIResponseSpec.describeWithWrongInputs(
				APIResponseSpec.successNoData(message),
				APIResponseSpec.notFound("Publisher not found"),
			),
		}),

		zValidator("param", AdminPublishersModel.Param),

		async (c) => {
			const authContext = AuthHandler.AuthContext.get(c);
			const { publisherName } = c.req.valid("param");

			const publisher = await DB.instance()
				.select({ id: DB.Tables.publishers.id, name: DB.Tables.publishers.name })
				.from(DB.Tables.publishers)
				.where(eq(DB.Tables.publishers.name, publisherName))
				.get();

			if (!publisher) {
				return APIResponse.notFound(c, "Publisher not found");
			}

			await DB.instance().transaction(async (tx) => {
				await tx
					.update(DB.Tables.publishers)
					.set({ verified_at: verify ? Date.now() : null })
					.where(eq(DB.Tables.publishers.id, publisher.id))
					.run();

				await AuditLog.record(
					{
						actor: authContext,
						action: `publisher.${action}`,
						targetType: "publisher",
						targetID: publisher.id,
						targetLabel: publisher.name,
					},
					tx,
				);
			});

			return APIResponse.successNoData(c, message);
		},
	);
}
