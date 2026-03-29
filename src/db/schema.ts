import type { TaskHandler } from '@cleverjs/utils';
import { desc, sql, eq } from 'drizzle-orm';
import {
    sqliteTable,
    integer,
    text,
    unique,
    index,
    uniqueIndex,
    foreignKey,
    primaryKey,
    check,
    sqliteView
} from 'drizzle-orm/sqlite-core';
import { SQLUtils } from './utils';
import type { PackageModel } from '../api/utils/shared-models/package';
import { UserAccountSettings } from '../api/utils/shared-models/accountData';
import { PermissionHelper } from '../utils/permission-helper';

/**
 * @deprecated Use DB.Tables.users to access this table.
 */
export const users = sqliteTable('users', {
    id: integer().primaryKey({ autoIncrement: true }),

    username: text().notNull().unique(),
    display_name: text().notNull(),
    email: text().notNull().unique(),
    password_hash: text().notNull(),

    role: text({
        enum: UserAccountSettings.Roles
    }).default("user").notNull(),

    created_at: SQLUtils.getCreatedAtColumn(),
});

/**
 * @deprecated Use DB.Tables.passwordResets to access this table.
 */
export const passwordResets = sqliteTable('password_resets', {
    token: text().primaryKey(),
    user_id: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
    created_at: SQLUtils.getCreatedAtColumn(),
    expires_at: integer().notNull()
});

/**
 * @deprecated Use DB.Tables.sessions to access this table.
 */
export const sessions = sqliteTable('sessions', {
    id: text().primaryKey(),
    hashed_token: text().notNull(),
    user_id: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
    user_role: text({
        enum: UserAccountSettings.Roles
    }).notNull().references(() => users.role),
    created_at: SQLUtils.getCreatedAtColumn(),
    expires_at: integer().notNull()
});

/**
 * @deprecated Use DB.Tables.apiKeys to access this table.
 */
export const apiKeys = sqliteTable('api_keys', {
    id: text().primaryKey(),
    hashed_token: text().notNull(),
    user_id: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
    user_role: text({
        enum: UserAccountSettings.Roles
    }).notNull().references(() => users.role),
    description: text().notNull(),
    created_at: SQLUtils.getCreatedAtColumn(),
    expires_at: integer(),
});



/**
 * Publishers (Organizations/Groups) that own and manage packages
 * @deprecated Use DB.Tables.publishers to access this table.
 */
export const publishers = sqliteTable('publishers', {
    id: integer().primaryKey({ autoIncrement: true }),

    name: text().notNull().unique(), // URL-safe name like "microsoft", "mozilla-foundation"
    display_name: text().notNull(),
    description: text().notNull(),
    homepage_url: text(),

    // db query to delete user while owning should fail
    // user has to transfer ownership first or delete before deleting their account
    owner_user_id: integer().notNull().references(() => users.id, { onDelete: 'restrict' }),
    created_at: SQLUtils.getCreatedAtColumn()
});


/**
 * @deprecated Use DB.Tables.publisherMembers to access this table.
 */
export const publisherMembers = sqliteTable('publisher_members', {
    id: integer().primaryKey({ autoIncrement: true }),

    // Publisher id 
    publisher_id: integer().notNull().references(() => publishers.id, { onDelete: 'cascade' }),

    user_id: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),

    role: text({
        enum: PermissionHelper.OrgRolesAsTuple
    }).notNull(),
    
    added_at: SQLUtils.getCreatedAtColumn(),

}, (table) => ([
    unique().on(table.user_id, table.publisher_id)
]));

/**
 * Role assignments link users to roles at different scopes
 * Scope can be publisher-level, group-level, or package-level
 * the specified role of the assignment have to be higher than the role in the parent scope (or publisher base role if no parent group)
 * @deprecated Use DB.Tables.roleAssignments to access this table.
 */
export const roleAssignments = sqliteTable('role_assignments', {
    id: integer().primaryKey({ autoIncrement: true }),

    package_id: integer().references(() => packages.id, { onDelete: 'cascade' }),

    user_id: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),

    role: text({
        enum: PermissionHelper.OrgRolesAsTuple
    }).notNull(),
    
    created_at: SQLUtils.getCreatedAtColumn(),

}, (table) => ([
    unique().on(table.user_id, table.package_id)
]));




/**
 * For now package names are allowed to include dots for logical namspacing: name: [...groups.]pkgname, fullname: publisher.[...groups.]pkgname
 * but we will add real grouping later.
 * @deprecated Use DB.Tables.packages to access this table.
 */
export const packages = sqliteTable('packages', {
    id: integer().primaryKey({ autoIncrement: true }),

    publisher_id: integer().notNull().references(() => publishers.id, { onDelete: 'cascade' }),

    name: text().notNull(), // URL-safe name like "vscode" (not unique, only unique within publisher/group)
    // fullname: text().notNull().unique(), // Full hierarchical name: publisher.[...groups].pkgname or publisher.pkgname

    // optional top level alias like vscode -> microsoft.vscode
    // alias works by using meta packages that point to the real package
    // for now a package can only have one alias, but in the future we might want to support multiple aliases for the same package
    topLevelAlias: text().unique(),

    description: text().notNull(),
    homepage_url: text().notNull(),
    

    flags: text({ mode: 'json' }).$type<PackageModel.PackageFlags>().notNull().default(sql`'[]'`),

    // Requires patching may be controlled by a flag in the flags array in the future.
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

}, (table) => [
    unique().on(table.publisher_id, table.name),
    index("packages_publisher_id_idx").on(table.publisher_id)
]);

/**
 * @deprecated Use DB.Tables.packageReleases to access this table.
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


export const packageFullView = sqliteView('package_full_view').as((db) => {

    return db.select({

        id: packages.id,

        publisher_id: packages.publisher_id,

        name: packages.name,
        fullname: sql<string>`${publishers.name} || '.' || ${packages.name}`.as('fullname'),

        topLevelAlias: packages.topLevelAlias,

        description: packages.description,
        homepage_url: packages.homepage_url,

        flags: packages.flags,
        requires_patching: packages.requires_patching,

        created_at: packages.created_at,

        latest_stable_release: packages.latest_stable_release,
        latest_testing_release: packages.latest_testing_release,

    }).from(packages)
    .leftJoin(publishers, eq(packages.publisher_id, publishers.id));

});


/**
 * @deprecated Use DB.Tables.stablePromotionRequests to access this table.
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
 * @deprecated Use DB.Models.os_releases to access this table.
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




/**
 * @deprecated Use DB.Tables.scheduled_tasks to access this table.
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
 * @deprecated Use DB.Models.scheduled_tasks_paused_state to access this table.
 */
export const scheduled_tasks_paused_state = sqliteTable('scheduled_tasks_paused_state', {
    task_id: integer().primaryKey().references(() => scheduled_tasks.id),
    next_step_to_execute: integer().notNull(),
    data: text({ mode: 'json' }).$type<TaskHandler.TempPausedTaskState["data"]>().notNull(),
});

/**
 * @deprecated Use DB.Tables.tmp_data to access this table.
 */
export const metadata = sqliteTable('metadata', {
    key: text().primaryKey(),
    data: text({ mode: 'json' }).$type<Record<string, any> | Array<any>>().notNull()
});



