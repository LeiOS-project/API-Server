import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import { DB } from "../../../../../../db";
import { PermissionHelper } from "../../../../../../utils/permission-helper";

export namespace RoleAssignmentsModel {
	export const Entity = createSelectSchema(DB.Tables.roleAssignments);
	export type Entity = z.infer<typeof Entity>;

	export const EntityWithUser = Entity.extend({
		user_username: z.string(),
		user_display_name: z.string().nullable(),
		publisher_role: z.string().nullable(),
	});
	export type EntityWithUser = z.infer<typeof EntityWithUser>;
}

export namespace RoleAssignmentsModel.ListAll {
	export const Response = z.array(RoleAssignmentsModel.EntityWithUser);
	export type Response = z.infer<typeof Response>;
}

export namespace RoleAssignmentsModel.Create {
	export const Body = z.object({
		user_id: z.number().int().positive(),
		role: z.enum(PermissionHelper.OrgRolesAsTuple),
	});

	export type Body = z.infer<typeof Body>;
}

export namespace RoleAssignmentsModel.Update {
	export const Body = z.object({
		role: z.enum(PermissionHelper.OrgRolesAsTuple),
	});

	export type Body = z.infer<typeof Body>;
}
