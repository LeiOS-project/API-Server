import {
    sqliteTable,
    int,
    text
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
 * this is only used for linking a package to a owner, and setting defaults, anything other in handled by aptly
 * @deprecated Use DB.Schema.packages instead
 */
export const packages = sqliteTable('packages', {
    // for security reasons, the package name cannot be changed once created
    name: text().primaryKey(),
    owner_user_id: int().notNull().references(() => users.id),
    description: text().notNull(),
    homepage_url: text().notNull(),
});