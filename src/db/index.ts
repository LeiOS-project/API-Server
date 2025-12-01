import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as TableSchema from './schema';
import { randomBytes as crypto_randomBytes } from 'crypto';
import { DrizzleDB } from './utils';

export class DB {

    protected static db: DrizzleDB;

    static async init(path: string) {
        this.db = drizzle(path);

        await this.createInitialAdminUserIfNeeded();

        console.log('Database initialized at');
    }

    static async createInitialAdminUserIfNeeded() {
        const usersTableEmpty = (await this.db.select().from(DB.Schema.users).limit(1)).length === 0;
        if (!usersTableEmpty) return;

        const username = "admin";
        const randomPassword = crypto_randomBytes(32).toString('hex');

        await this.db.insert(DB.Schema.users).values({
            username,
            email: "admin@leios.local",
            password_hash: await Bun.password.hash(randomPassword),
            role: "admin"
        });

        Bun.file('./data/initial_admin_credentials.txt').write(`Username: ${username}\nPassword: ${randomPassword}\n`);

        console.log(`Initial admin user created with username: ${username} and password: ${randomPassword} (also saved to ./data/initial_admin_credentials.txt)`);
    }

    static instance() {
        if (!this.db) {
            throw new Error('Database not initialized. Call DB.init() first.');
        }
        return DB.db;
    }

}


export namespace DB.Schema {
    export const users = TableSchema.users;
    export const sessions = TableSchema.sessions;
    export const passwordResets = TableSchema.passwordResets;
    export const apiKeys = TableSchema.apiKeys;
}

export namespace DB.Models {
    export type User = typeof DB.Schema.users.$inferSelect;
    export type Session = typeof DB.Schema.sessions.$inferSelect;
    export type PasswordReset = typeof DB.Schema.passwordResets.$inferSelect;
    export type ApiKey = typeof DB.Schema.apiKeys.$inferSelect;
}