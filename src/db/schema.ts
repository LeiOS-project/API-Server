import type { TaskHandler } from '@cleverjs/utils';
import { desc, sql } from 'drizzle-orm';
import {
    sqliteTable,
    integer,
    text
} from 'drizzle-orm/sqlite-core';
import { SQLUtils } from './utils';
import type { PackageModel } from '../api/utils/shared-models/package';
import { UserAccountSettings } from '../api/utils/shared-models/accountData';

/**
 * @deprecated Use DB.Schema.users instead
 */
export const users = sqliteTable('users', {
    id: integer().primaryKey({ autoIncrement: true }),
    created_at: SQLUtils.getCreatedAtColumn(),
    username: text().notNull().unique(),
    display_name: text().notNull(),
    email: text().notNull().unique(),
    password_hash: text().notNull(),
    role: text({
        enum: UserAccountSettings.Roles
    }).default("user").notNull()
});

/**
 * @deprecated Use DB.Schema.passwordResets instead
 */
export const passwordResets = sqliteTable('password_resets', {
    token: text().primaryKey(),
    user_id: integer().notNull().references(() => users.id),
    created_at: SQLUtils.getCreatedAtColumn(),
    expires_at: integer().notNull()
});

/**
 * @deprecated Use DB.Schema.sessions instead
 */
export const sessions = sqliteTable('sessions', {
    id: text().primaryKey(),
    hashed_token: text().notNull(),
    user_id: integer().notNull().references(() => users.id),
    user_role: text({
        enum: UserAccountSettings.Roles
    }).notNull().references(() => users.role),
    created_at: SQLUtils.getCreatedAtColumn(),
    expires_at: integer().notNull()
});

/**
 * @deprecated Use DB.Schema.apiKeys instead
 */
export const apiKeys = sqliteTable('api_keys', {
    id: text().primaryKey(),
    hashed_token: text().notNull(),
    user_id: integer().notNull().references(() => users.id),
    user_role: text({
        enum: UserAccountSettings.Roles
    }).notNull().references(() => users.role),
    description: text().notNull(),
    created_at: SQLUtils.getCreatedAtColumn(),
    expires_at: integer(),
});


/**
 * @deprecated Use DB.Schema.packages instead
 */
export const packages = sqliteTable('packages', {
    id: integer().primaryKey({ autoIncrement: true }),
    name: text().notNull().unique(),
    owner_user_id: integer().notNull().references(() => users.id),
    flags: text({ mode: 'json' }).$type<PackageModel.PackageFlags>().notNull().default(sql`'[]'`),
    description: text().notNull(),
    homepage_url: text().notNull(),
    requires_patching: integer({ mode: 'boolean' }).notNull().default(sql`0`),
    created_at: SQLUtils.getCreatedAtColumn(),

    // version strings of version + leios patch if exists
    latest_stable_release: text({ mode: "json" }).notNull().$type<{
        amd64: string | null;
        arm64: string | null;
    }>().default(sql`'{"amd64": null, "arm64": null}'`),

    latest_testing_release: text({ mode: "json" }).notNull().$type<{
        amd64: string | null;
        arm64: string | null;
    }>().default(sql`'{"amd64": null, "arm64": null}'`),
});

/**
 * @deprecated Use DB.Schema.packageReleases instead
 */
export const packageReleases = sqliteTable('package_releases', {
    id: integer().primaryKey({ autoIncrement: true }),
    package_id: integer().notNull().references(() => packages.id),
    versionWithLeiosPatch: text().notNull(),
    
    // architecture: text({ enum: ['amd64', 'arm64'] }).notNull(),
    //architectures: text({ mode: "json" }).$type<("amd64" | "arm64")[]>().notNull(),
    architectures: text({ mode: "json" }).notNull().$type<{
        amd64: boolean;
        arm64: boolean;
        is_all: boolean;
    }>().default(sql`'{"amd64": false, "arm64": false, "is_all": false}'`),

    created_at: SQLUtils.getCreatedAtColumn(),
    changelog: text().notNull(),
});

/**
 * @deprecated Use DB.Schema.stablePromotionRequests instead
 */
export const stablePromotionRequests = sqliteTable('stable_promotion_requests', {
    id: integer().primaryKey({ autoIncrement: true }),
    package_id: integer().notNull().references(() => packages.id),
    package_release_id: integer().unique().notNull().references(() => packageReleases.id),
    status: text({ enum: ['pending', 'approved', 'denied'] }).default('pending').notNull(),
    created_at: SQLUtils.getCreatedAtColumn(),
    admin_note: text(),
});

/**
 * @deprecated Use DB.Schema.scheduled_tasks instead
 */
export const scheduled_tasks = sqliteTable('scheduled_tasks', {
    id: integer().primaryKey({ autoIncrement: true }),
    function: text().notNull(),
    created_by_user_id: integer().references(() => users.id),
    args: text({ mode: 'json' }).$type<Record<string, any>>().notNull(),
    autoDelete: integer({ mode: 'boolean' }).notNull().default(sql`0`),
    storeLogs: integer({ mode: 'boolean' }).notNull().default(sql`0`),
    status: text({ enum: ["pending", "running", "paused", "failed", "completed"] }).notNull().default('pending'),
    created_at: integer().notNull(),
    finished_at: integer(),
    result: text({ mode: 'json' }).$type<Record<string, any>>(),
    message: text(),
});

/**
 * @deprecated Use DB.Models.scheduled_tasks_paused_state instead
 */
export const scheduled_tasks_paused_state = sqliteTable('scheduled_tasks_paused_state', {
    task_id: integer().primaryKey().references(() => scheduled_tasks.id),
    next_step_to_execute: integer().notNull(),
    data: text({ mode: 'json' }).$type<TaskHandler.TempPausedTaskState["data"]>().notNull(),
});

/**
 * @deprecated Use DB.Schema.tmp_data instead
 */
export const metadata = sqliteTable('metadata', {
    key: text().primaryKey(),
    data: text({ mode: 'json' }).$type<Record<string, any> | Array<any>>().notNull()
});


/**
 * @deprecated Use DB.Models.os_releases instead
 */
export const os_releases = sqliteTable('os_releases', {
    id: integer().primaryKey({ autoIncrement: true }),
    // YYYY.MM.(release_this_month) format
    version: text().notNull().unique(),
    changelog: text().notNull(),
    created_at: SQLUtils.getCreatedAtColumn(),
    taskID: integer().notNull().references(() => scheduled_tasks.id),
    // published_at: int().references(() => scheduled_tasks.finished_at),
});
