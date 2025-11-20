import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Resource } from "./utils";
import { DrizzleDB } from "../utils";
import { usersTable } from "../schema";
import { eq } from "drizzle-orm/sqlite-core/expressions";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import z from "zod";


export type UserModel = typeof usersTable.$inferSelect;


export class UserResource extends Resource {

    readonly schemas = {
        create: createInsertSchema(usersTable, {
            email: z.email()
        }),
        select: createSelectSchema(usersTable, {
            email: z.email()
        }),
        update: createUpdateSchema(usersTable, {
            email: z.email().optional()
        }),
    }    

    insert(data: z.infer<typeof this.schemas.create>) {
        return this.db.insert(usersTable).values(data);

    }

    select(data: z.infer<typeof this.schemas.select>) {
        return this.db.select().from(usersTable).where(eq(usersTable.id, data.id));
    }

    update(id: number, data: z.infer<typeof this.schemas.update>) {
        return this.db.update(usersTable).set(data).where(eq(usersTable.id, id));
    }

    async delete(id: number): Promise<void> {
        return await this.db.delete(usersTable).where(eq(usersTable.id, id));
    }

};


