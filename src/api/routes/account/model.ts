import { createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { DB } from "../../../db";
import { z } from "zod";

export namespace AccountModel.GetInfo {

    export const Response = createSelectSchema(DB.Schema.users).omit({
        password_hash: true
    });
    export type Response = z.infer<typeof Response>;

}

export namespace AccountModel.UpdateInfo {

    export const Body = createUpdateSchema(DB.Schema.users, {
        username: z.string()
            .min(5, 'Must be at least 5 characters')
            .max(30, 'Must be at most 30 characters')
            .regex(/^[a-zA-Z0-9_]+$/, 'Only alphanumeric characters and underscores are allowed'),
        email: z.email('Invalid email'),
    }).omit({
        id: true,
        password_hash: true,
        role: true
    }).partial().refine(
        (data) => Object.values(data).some((value) => value !== undefined),
        { message: "At least one field must be provided" }
    );

    export type Body = z.infer<typeof Body>;

}

export namespace AccountModel.UpdatePassword {

    export const Body = z.object({
        current_password: z.string().describe("Current password of the account"),
        new_password: z.string()
            .min(8, 'Must be at least 8 characters')
            .max(50, 'Must be at most 50 characters')
            .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
            .regex(/[a-z]/, 'Must contain at least one lowercase letter')
            .regex(/[0-9]/, 'Must contain at least one number')
            .regex(/[\W_]/, 'Must contain at least one special character')
            .describe("New password for the account")
    });

    export type Body = z.infer<typeof Body>;

}