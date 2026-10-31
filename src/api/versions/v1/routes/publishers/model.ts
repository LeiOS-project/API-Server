import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import z from "zod";
import { DB } from "../../../../../db";
import { PermissionHelper } from "../../../../../utils/permission-helper";
import { ApiHelperModels } from "../../../../utils/shared-models/api-helper-models";

export namespace PublisherModel {
	const ForbiddenPublisherNames = [
		"admin",
		"user",
		"users",
		"package",
		"packages",
		"release",
		"releases",
		"os",
		"api",
		"dashboard",
		"home",
		"settings",
		"login",
		"logout",
		"register",
		"auth",
		"static",
		"public",
		"new",
		"edit",
		"delete",
		"update",
		"create",
		"list",
		"all",
		"latest",
		"stable",
		"testing",
		"beta",
		"alpha",
		"dev",
		"development",
		"developer",
		"prod",
		"production",

		"root",
		"sys",
		"system",

		// Forbidden LeiCraft_MC related names
		"leicraft",
		"leios",
	];

	// Publisher name validation: lowercase, alphanumeric, hyphens allowed
	export const SelectPublisherNameSchema = z
		.string()
		.min(2, "Publisher name must be at least 2 characters long.")
		.max(50, "Publisher name cannot exceed 50 characters.")
		.regex(
			/^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
			"Publisher name must be lowercase, may contain hyphens, and start/end with a letter or number.",
		);

	// Publisher name validation: lowercase, alphanumeric, hyphens allowed
	export const CreatePublisherNameSchema = SelectPublisherNameSchema.refine(
		(name) => !ForbiddenPublisherNames.includes(name),
		{
			message: "This publisher name is reserved and cannot be used.",
		},
	);

	export const OrgRoleSchema = z.enum(PermissionHelper.OrgRolesAsTuple);
}

export namespace PublisherModel.GetPublisherByName {
	export const Response = createSelectSchema(DB.Tables.publishers).omit({
		owner_user_id: true,
	});

	export type Response = z.infer<typeof Response>;
}

export namespace PublisherModel.GetAll {
	export const Query = ApiHelperModels.ListAll.QueryWithSearch.omit({
		order: true,
	}).extend({
		onlyMembershipByMe: ApiHelperModels.QueryBoolean.default(false),
	});

	export type Query = z.infer<typeof Query>;

	export const Response = ApiHelperModels.Paginated(PublisherModel.GetPublisherByName.Response);

	export type Response = z.infer<typeof Response>;
}

export namespace PublisherModel.CreatePublisher {
	export const Body = createInsertSchema(DB.Tables.publishers, {
		name: PublisherModel.CreatePublisherNameSchema,
		display_name: z
			.string()
			.min(1, "Display name is required")
			.max(200, "Display name cannot exceed 200 characters."),
		description: z
			.string()
			.min(1, "Description is required")
			.max(500, "Description cannot exceed 500 characters."),
		homepage_url: z
			.url("Homepage URL must be a valid URL.")
			.max(500, "Homepage URL cannot exceed 500 characters."),

		maintainer_contact_name: z
			.string()
			.min(1, "Maintainer contact name is required")
			.max(254, "Maintainer contact name cannot exceed 200 characters."),
		maintainer_contact_email: z
			.email("Maintainer contact email must be a valid email address.")
			.max(254, "Maintainer contact email cannot exceed 200 characters."),
	}).omit({
		id: true,
		created_at: true,
		owner_user_id: true,
	});

	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		id: z.number().int().positive(),
	});

	export type Response = z.infer<typeof Response>;
}

export namespace PublisherModel.UpdatePublisher {
	export const Body = PublisherModel.CreatePublisher.Body.omit({
		name: true,
	})
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});

	export type Body = z.infer<typeof Body>;
}

export namespace PublisherModel.TransferOwnership {
	export const Body = z.object({
		new_owner_user_id: z.number().int().positive(),
	});

	export type Body = z.infer<typeof Body>;
}
