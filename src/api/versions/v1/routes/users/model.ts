import { z } from "zod";
import { DB } from "../../../../../db";
import { createSelectSchema } from "drizzle-zod";

export namespace UsersPublicModel {

    const SafeUser = createSelectSchema(DB.Tables.users).omit({
        email: true,
        password_hash: true,
        role: true,
        created_at: true
    });

    export type SafeUser = z.infer<typeof SafeUser>;

    export namespace Search {
        export const Query = z.object({
            q: z.string().min(2, "Search query must be at least 2 characters long").max(64),
            limit: z.coerce.number().int().min(1).max(50).default(10)
        });
        export type Query = z.infer<typeof Query>;

        export const Response = z.array(SafeUser);
        export type Response = z.infer<typeof Response>;
    }

}
