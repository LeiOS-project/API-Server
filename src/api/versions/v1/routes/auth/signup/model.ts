import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import { DB } from "../../../../../../db";
import { UserDataPolicies } from "../../../../../utils/shared-models/accountData";

export namespace SignupModel.Signup {
	export const Body = z.object({
		username: UserDataPolicies.Username,
		display_name: z.string().min(1).max(64),
		email: z.email(),
		password: UserDataPolicies.Password,
	});
	export type Body = z.infer<typeof Body>;

	export const Response = createSelectSchema(DB.Tables.users).pick({
		id: true,
		username: true,
		display_name: true,
		email: true,
		email_verified_at: true,
	});
	export type Response = z.infer<typeof Response>;
}
