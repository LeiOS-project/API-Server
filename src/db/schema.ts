import type { TaskHandler } from '@cleverjs/utils';
import { desc, sql } from 'drizzle-orm';
import {
    sqliteTable,
    int,
    text,
    
} from 'drizzle-orm/sqlite-core';

/**
 * @deprecated Use DB.Schema.users instead
 */
export const users = sqliteTable('users', {
    id: int().primaryKey({ autoIncrement: true }),
    created_at: int().notNull(),
    username: text().notNull().unique(),
    display_name: text().notNull(),
    email: text().notNull().unique(),
    password_hash: text().notNull(),
    role: text({
        enum: ['admin', 'developer', 'user']
    }).default('user').notNull()
});

/**
 * @deprecated Use DB.Schema.passwordResets instead
 */
export const passwordResets = sqliteTable('password_resets', {
    token: text().primaryKey(),
    user_id: int().notNull().references(() => users.id),
    created_at: int().notNull(),
    expires_at: int().notNull()
});

/**
 * @deprecated Use DB.Schema.sessions instead
 */
export const sessions = sqliteTable('sessions', {
    id: text().primaryKey(),
    hashed_token: text().notNull(),
    user_id: int().notNull().references(() => users.id),
    user_role: text({
        enum: ['admin', 'developer', 'user']
    }).notNull().references(() => users.role),
    created_at: int().notNull(),
    expires_at: int().notNull()
});

/**
 * @deprecated Use DB.Schema.apiKeys instead
 */
export const apiKeys = sqliteTable('api_keys', {
    id: text().primaryKey(),
    hashed_token: text().notNull(),
    user_id: int().notNull().references(() => users.id),
    user_role: text({
        enum: ['admin', 'developer', 'user']
    }).notNull().references(() => users.role),
    description: text().notNull(),
    created_at: int().notNull(),
    expires_at: int(),
});


/**
 * @deprecated Use DB.Schema.packages instead
 */
export const packages = sqliteTable('packages', {
    id: int().primaryKey({ autoIncrement: true }),
    name: text().notNull().unique(),
    owner_user_id: int().notNull().references(() => users.id),
    description: text().notNull(),
    homepage_url: text().notNull(),
    requires_patching: int({ mode: 'boolean' }).notNull().default(sql`0`),
    created_at: int().notNull(),
    // version strings of version + leios patch if exists
    latest_stable_release_amd64: text(),
    latest_stable_release_arm64: text(),
    latest_testing_release_amd64: text(),
    latest_testing_release_arm64: text(),
});

/**
 * @deprecated Use DB.Schema.packageReleases instead
 */
export const packageReleases = sqliteTable('package_releases', {
    id: int().primaryKey({ autoIncrement: true }),
    package_id: int().notNull().references(() => packages.id),
    versionWithLeiosPatch: text().notNull(),
    // architecture: text({ enum: ['amd64', 'arm64'] }).notNull(),
    architecture: text({ mode: "json" }).$type<("amd64" | "arm64")[]>().notNull(),
    created_at: int().notNull(),
});

/**
 * @deprecated Use DB.Schema.stablePromotionRequests instead
 */
export const stablePromotionRequests = sqliteTable('stable_promotion_requests', {
    id: int().primaryKey({ autoIncrement: true }),
    package_id: int().notNull().references(() => packages.id),
    package_release_id: int().unique().notNull().references(() => packageReleases.id),
    status: text({ enum: ['pending', 'approved', 'denied'] }).default('pending').notNull(),
    created_at: int().notNull(),
    admin_note: text(),
});

/**
 * @deprecated Use DB.Schema.scheduled_tasks instead
 */
export const scheduled_tasks = sqliteTable('scheduled_tasks', {
    id: int().primaryKey({ autoIncrement: true }),
    function: text().notNull(),
    tag: text().notNull(),
    created_by_user_id: int().references(() => users.id),
    args: text({ mode: 'json' }).$type<Record<string, any>>().notNull(),
    autoDelete: int({ mode: 'boolean' }).notNull().default(sql`0`),
    storeLogs: int({ mode: 'boolean' }).notNull().default(sql`0`),
    status: text({ enum: ["pending", "running", "paused", "failed", "completed"] }).notNull().default('pending'),
    created_at: int().notNull(),
    finished_at: int(),
    result: text({ mode: 'json' }).$type<Record<string, any>>(),
    message: text(),
});

/**
 * @deprecated Use DB.Models.scheduled_tasks_paused_state instead
 */
export const scheduled_tasks_paused_state = sqliteTable('scheduled_tasks_paused_state', {
    task_id: int().primaryKey().references(() => scheduled_tasks.id),
    next_step_to_execute: int().notNull(),
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
    id: int().primaryKey({ autoIncrement: true }),
    // YYYY.MM.(release_this_month) format
    version: text().notNull().unique(),
    created_at: int().notNull(),
    published_at: int().notNull(),
});
