import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../db";

export namespace Model.Login {

    export const Body = z.object({
        username: z.string(),
        password: z.string()
    });
    export type Body = z.infer<typeof Body>;

    export const Response = createSelectSchema(DB.Schema.sessions);
    export type Response = z.infer<typeof Response>;
}

export namespace Model.Session {

    export const Response = createSelectSchema(DB.Schema.sessions);
    export type Response = z.infer<typeof Response>;

}