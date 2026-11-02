import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import { DB } from "../../../../../../db";
import { PublisherModel } from "../model";

export namespace PublisherMembersModel.GetByID {
	export const Response = createSelectSchema(DB.Tables.publisherMembers)
		.omit({
			publisher_id: true,
		})
		.extend({
			user_username: z.string(),
			user_display_name: z.string(),
		});

	export type Response = z.infer<typeof Response>;
}

export namespace PublisherMembersModel.ListAll {
	export const Response = z.array(PublisherMembersModel.GetByID.Response);
	export type Response = z.infer<typeof Response>;
}

export namespace PublisherMembersModel.Add {
	export const Body = z.object({
		user_id: z.number().int().positive(),
		role: PublisherModel.OrgRoleSchema,
		is_publicly_hidden: z.boolean().optional().default(false),
	});

	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		id: z.number().int().positive(),
	});

	export type Response = z.infer<typeof Response>;
}

export namespace PublisherMembersModel.Update {
	export const Body = z
		.object({
			role: PublisherModel.OrgRoleSchema.optional(),
			is_publicly_hidden: z.boolean().optional(),
		})
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});

	export type Body = z.infer<typeof Body>;
}
