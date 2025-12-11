import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as TableSchema from './schema';
import { randomBytes as crypto_randomBytes } from 'crypto';
import { DrizzleDB } from './utils';
import { Logger } from '../utils/logger';
import {  } from 'drizzle-kit';
import { eq } from 'drizzle-orm';

export class DB {

    protected static db: DrizzleDB;

    static async init(path: string) {
        this.db = drizzle(path);

        await this.createInitialAdminUserIfNeeded();

        Logger.info(`Database initialized at ${path}`);
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
            display_name: "Default Administrator",
            role: "admin"
        });

        Bun.file('./data/initial_admin_credentials.txt').write(`Username: ${username}\nPassword: ${randomPassword}\n`);

        Logger.info(`Initial admin user created with username: ${username} and password: ${randomPassword} (also saved to ./data/initial_admin_credentials.txt)`);
    }

    static async createInitialReleasesMetaIfNeeded() {

        const initalReleaseExists = await this.db.select().from(DB.Schema.os_releases).where(
            eq(DB.Schema.os_releases.version, "0000.00.00")
        ).get();

        if (!initalReleaseExists) {
            await this.db.insert(DB.Schema.os_releases).values({
                version: "0000.00.00",
                published_at: new Date(0).getTime(),
            });
            Logger.info("Created initial OS release metadata entry (version 0000.00.00)");
        }

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

    export const packages = TableSchema.packages;
    export const packageReleases = TableSchema.packageReleases;

    export const stablePromotionRequests = TableSchema.stablePromotionRequests;

    export const os_releases = TableSchema.os_releases;

    export const scheduled_tasks = TableSchema.scheduled_tasks;
    export const scheduled_tasks_paused_state = TableSchema.scheduled_tasks_paused_state;

    export const metadata = TableSchema.metadata;
}

export namespace DB.Models {
    export type User = typeof DB.Schema.users.$inferSelect;
    export type Session = typeof DB.Schema.sessions.$inferSelect;
    export type PasswordReset = typeof DB.Schema.passwordResets.$inferSelect;
    export type ApiKey = typeof DB.Schema.apiKeys.$inferSelect;

    export type Package = typeof DB.Schema.packages.$inferSelect;
    export type PackageRelease = typeof DB.Schema.packageReleases.$inferSelect;

    export type StablePromotionRequest = typeof DB.Schema.stablePromotionRequests.$inferSelect;

    export type OSRelease = typeof DB.Schema.os_releases.$inferSelect;

    export type ScheduledTask = typeof DB.Schema.scheduled_tasks.$inferSelect;
    export type ScheduledTaskPausedState = typeof DB.Schema.scheduled_tasks_paused_state.$inferSelect;

    export type Metadata = typeof DB.Schema.metadata.$inferSelect;
}