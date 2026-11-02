import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import z from "zod";
import { DB } from "../../../../../../db";
import { PermissionHelper } from "../../../../../../utils/permission-helper";
import {
	UserAccountSettings,
	UserDataPolicies,
} from "../../../../../utils/shared-models/accountData";
import { ApiHelperModels } from "../../../../../utils/shared-models/api-helper-models";

export namespace UsersModel {
	const BaseUser = createSelectSchema(DB.Tables.users);

	export const SafeUser = BaseUser.omit({ password_hash: true });
	export type SafeUser = z.infer<typeof SafeUser>;

	export namespace GetAll {
		export const Query = z.object({
			role: UserAccountSettings.Role.optional(),
			status: UserAccountSettings.Status.optional(),
			verified: ApiHelperModels.QueryBoolean.optional(),
			search: z.string().min(1).max(64).optional(),
			limit: z.coerce.number().int().min(1).max(100).default(25),
			offset: z.coerce.number().int().min(0).default(0),
		});
		export type Query = z.infer<typeof Query>;

		export const Response = ApiHelperModels.Paginated(SafeUser);
		export type Response = z.infer<typeof Response>;
	}

	export namespace Create {
		const InsertSchema = createInsertSchema(DB.Tables.users, {
			username: UserDataPolicies.Username,
			display_name: z.string().min(1).max(64),
			email: z.email(),
			// Allowlist: suspension and email confirmation have their own (audited) endpoints.
		}).pick({
			username: true,
			display_name: true,
			email: true,
			role: true,
		});

		export const Body = InsertSchema.extend({
			password: z.string().min(8).max(128),
		});
		export type Body = z.infer<typeof Body>;

		export const Response = SafeUser;
		export type Response = z.infer<typeof Response>;
	}

	export namespace Update {
		export const Body = createUpdateSchema(DB.Tables.users, {
			username: UserDataPolicies.Username,
			display_name: z.string().min(1).max(64),
			email: z.email(),
		})
			// Allowlist: suspension and email verification have their own endpoints.
			.pick({
				username: true,
				display_name: true,
				email: true,
				role: true,
			})
			.partial()
			.refine((data) => Object.values(data).some((value) => value !== undefined), {
				message: "At least one field must be provided",
			});
		export type Body = z.infer<typeof Body>;
	}

	export namespace UpdatePassword {
		export const Body = z.object({
			password: UserDataPolicies.Password,
		});
		export type Body = z.infer<typeof Body>;
	}

	export namespace UserId {
		export const Params = z.object({
			userId: z.coerce.number().int().positive(),
		});
		export type Params = z.infer<typeof Params>;
	}

	export namespace Suspend {
		export const Body = z.object({
			reason: z.string().min(1).max(500),
		});
		export type Body = z.infer<typeof Body>;
	}

	export namespace PasswordResetLink {
		export const Body = z.object({
			/** Also email the link to the user (when email is configured). */
			send_email: z.boolean().default(false),
		});
		export type Body = z.infer<typeof Body>;

		export const Response = z.object({
			reset_url: z.string(),
			expires_at: z.number().int(),
			emailed: z.boolean(),
		});
		export type Response = z.infer<typeof Response>;
	}

	export namespace Publishers {
		export const Response = z.array(
			z.object({
				id: z.number().int(),
				name: z.string(),
				display_name: z.string(),
				verified_at: z.number().int().nullable(),
				role: z.enum(PermissionHelper.OrgRolesAsTuple),
				is_owner: z.boolean(),
			}),
		);
		export type Response = z.infer<typeof Response>;
	}
}
