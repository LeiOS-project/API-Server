import { sql } from 'drizzle-orm';
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
    expires_at: int().notNull()
});

/**
 * @deprecated Use DB.Schema.sessions instead
 */
export const sessions = sqliteTable('sessions', {
    token: text().primaryKey(),
    user_id: int().notNull().references(() => users.id),
    user_role: text({
        enum: ['admin', 'developer', 'user']
    }).notNull().references(() => users.role),
    expires_at: int().notNull()
});

/**
 * @deprecated Use DB.Schema.apiKeys instead
 */
export const apiKeys = sqliteTable('api_keys', {
    id: int().primaryKey({ autoIncrement: true }),
    token: text().notNull().unique(),
    user_id: int().notNull().references(() => users.id),
    user_role: text({
        enum: ['admin', 'developer', 'user']
    }).notNull().references(() => users.role),
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
    version: text().notNull(),
    leios_patch: text(),
    architecture: text({ enum: ['amd64', 'arm64'] }).notNull(),
});

/**
 * @deprecated Use DB.Schema.stablePromotionRequests instead
 */
export const stablePromotionRequests = sqliteTable('stable_promotion_requests', {
    id: int().primaryKey({ autoIncrement: true }),
    package_id: int().notNull().references(() => packages.id),
    package_release_id: int().unique().notNull().references(() => packageReleases.id),
    status: text({ enum: ['pending', 'approved', 'denied'] }).default('pending').notNull(),
    decision_reason: text(),
});

export const scheduled_tasks = sqliteTable('scheduled_tasks', {
    id: int().primaryKey({ autoIncrement: true }),
    job_type: text().notNull(),
    trigger: text({ enum: ["manual"] }).notNull(),
    function: text().notNull(),
    payload: text({ mode: 'json' }).notNull(),
});

/**
 * @deprecated Use DB.Models.os_releases instead
 */
export const os_releases = sqliteTable('os_releases', {
    id: int().primaryKey({ autoIncrement: true }),
    version: text().notNull().unique(),
});