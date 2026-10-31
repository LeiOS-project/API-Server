import { createHash as crypto_createHash, randomBytes as crypto_randomBytes } from "node:crypto";
import { mkdir as fs_mkdir } from "node:fs/promises";
import { dirname as path_dirname, join as path_join } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { ConfigHandler } from "../utils/config";
import { Logger } from "../utils/logger";
import { PermissionHelper } from "../utils/permission-helper";
import * as TableSchema from "./schema";
import type { DrizzleDB } from "./utils";

export class DB {
	protected static db: DrizzleDB.BunSQLite;

	static async init(
		path: string,
		autoMigrate: boolean,
		configBaseDir: string,
		migrationsFolder: string,
	) {
		await fs_mkdir(path_dirname(path), { recursive: true });
		await fs_mkdir(configBaseDir, { recursive: true });

		this.db = drizzle(path);
		if (autoMigrate) {
			Logger.info("Running database migrations...");

			// `Bun.isStandaloneExecutable` is newer than this repo's bun-types; compiled binaries also
			// run from the embedded `/$bunfs` file system.
			const isStandaloneExecutable =
				(Bun as { isStandaloneExecutable?: boolean }).isStandaloneExecutable ??
				import.meta.dir.startsWith("/$bunfs");

			if (isStandaloneExecutable) {
				// `bun build --compile --asset ./drizzle/migrations` embeds the files as `migrations/...`
				// next to the entry (`/$bunfs/root/migrations` on Linux) — without the `drizzle/` segment.
				migrationsFolder = path_join(import.meta.dir, "migrations");
			}

			await migrate(this.db, { migrationsFolder });

			Logger.info("Database migrations completed.");
		}

		const adminUserID = await this.createInitialAdminUserIfNeeded(configBaseDir);
		await this.createInitialLeiOSPublisherIfNeeded(adminUserID ?? 1);

		Logger.info(`Database initialized at ${path}`);
	}

	private static async createInitialAdminUserIfNeeded(configBaseDir: string) {
		const usersTableEmpty = (await this.db.select().from(DB.Tables.users).limit(1)).length === 0;
		if (!usersTableEmpty) return;

		const username = "admin";
		const passwordResetToken = crypto_randomBytes(64).toString("hex");

		let adminUserID: number;
		try {
			adminUserID = await this.db.transaction(async (tx) => {
				const id = tx
					.insert(DB.Tables.users)
					.values({
						username,
						email: "admin@leios.local",
						password_hash: await Bun.password.hash(crypto_randomBytes(32).toString("hex")),
						display_name: "Default Administrator",
						role: "admin",
					})
					.returning()
					.get().id;

				tx
					.insert(DB.Tables.passwordResets)
					.values({
						// Same hash as hashResetToken() in routes/auth/reset-password, which consumes it.
						token: crypto_createHash("sha256").update(passwordResetToken).digest("hex"),
						user_id: id,
						expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 Days
					})
					.run();

				return id;
			});
		} catch (error) {
			Logger.critical("Failed to create initial admin user:", error);
			throw error;
		}

		const APP_URL = ConfigHandler.getConfig()?.APP_URL ?? "https://<hub-url>";
		const resetUrl = `${APP_URL}/auth/reset-password?token=${passwordResetToken}`;
		const tokenFile = `${configBaseDir}/initial_admin_password_reset_token.txt`;

		await Bun.write(tokenFile, resetUrl, { mode: 0o600, createPath: true });

		Logger.info(
			`Initial admin user created with username: ${username}.\n` +
				`You can set the password under ${resetUrl}\n` +
				`The URL is also saved at ${tokenFile}\n`,
		);

		return adminUserID;
	}

	private static async createInitialLeiOSPublisherIfNeeded(admin_user_id: number) {
		const publisherExists = await this.db
			.select()
			.from(DB.Tables.publishers)
			.where(eq(DB.Tables.publishers.name, "leios"))
			.get();

		if (publisherExists) {
			Logger.info("LeiOS Project publisher already exists. Skipping creation.");
			return;
		}

		const adminUserExists = await this.db
			.select()
			.from(DB.Tables.users)
			.where(eq(DB.Tables.users.id, admin_user_id))
			.get();

		if (!adminUserExists) {
			throw new Error(
				`Admin user with ID ${admin_user_id} does not exist. Cannot create initial LeiOS publisher.`,
			);
		}

		await this.db.transaction(async (tx) => {
			const publisherID = await tx
				.insert(DB.Tables.publishers)
				.values({
					name: "leios",

					display_name: "LeiOS Project",
					description: "Official LeiOS Project Publisher",
					homepage_url: "https://www.leios.dev",

					owner_user_id: admin_user_id,

					maintainer_contact_name: "LeiOS Project Team",
					maintainer_contact_email: "support@leios.dev",
				})
				.returning()
				.get().id;

			await tx.insert(DB.Tables.publisherMembers).values({
				publisher_id: publisherID,
				role: PermissionHelper.OrgRoles.ADMIN,
				user_id: admin_user_id,
			});

			Logger.info("Created initial LeiOS Project publisher and assigned admin user.");
		});
	}

	static instance() {
		if (!this.db) {
			throw new Error("Database not initialized. Call DB.init() first.");
		}
		return DB.db;
	}

	static async close() {
		if (!this.db) return;

		Logger.info("Database connection closed.");
		await this.db.$client.close();

		// Release the OS file handle now (unfinalized statements hold it until GC), e.g. for
		// tests that delete the DB directory right after closing.
		Bun.gc(true);
		await Bun.sleep(500);
	}
}

export namespace DB.Tables {
	export const users = TableSchema.users;
	export const sessions = TableSchema.sessions;
	export const passwordResets = TableSchema.passwordResets;
	export const apiKeys = TableSchema.apiKeys;

	export const publishers = TableSchema.publishers;
	export const publisherMembers = TableSchema.publisherMembers;

	export const roleAssignments = TableSchema.roleAssignments;

	export const packages = TableSchema.packages;
	export const packageReleases = TableSchema.packageReleases;
	export const packagesFullView = TableSchema.packagesFullView;

	export const stablePromotionRequests = TableSchema.stablePromotionRequests;

	export const os_releases = TableSchema.os_releases;

	export const scheduled_tasks = TableSchema.scheduled_tasks;
	export const scheduled_tasks_paused_state = TableSchema.scheduled_tasks_paused_state;

	export const metadata = TableSchema.metadata;
}

export namespace DB.Models {
	export type User = typeof DB.Tables.users.$inferSelect;
	export type Session = typeof DB.Tables.sessions.$inferSelect;
	export type PasswordReset = typeof DB.Tables.passwordResets.$inferSelect;
	export type ApiKey = typeof DB.Tables.apiKeys.$inferSelect;

	export type Publisher = typeof DB.Tables.publishers.$inferSelect;
	export type PublisherMember = typeof DB.Tables.publisherMembers.$inferSelect;

	export type RoleAssignment = typeof DB.Tables.roleAssignments.$inferSelect;

	export type Package = typeof DB.Tables.packages.$inferSelect;
	export type PackageRelease = typeof DB.Tables.packageReleases.$inferSelect;
	export type PackageFullView = typeof DB.Tables.packagesFullView.$inferSelect;

	export type StablePromotionRequest = typeof DB.Tables.stablePromotionRequests.$inferSelect;

	export type OSRelease = typeof DB.Tables.os_releases.$inferSelect;

	export type ScheduledTask = typeof DB.Tables.scheduled_tasks.$inferSelect;
	export type ScheduledTaskPausedState = typeof DB.Tables.scheduled_tasks_paused_state.$inferSelect;

	export type Metadata = typeof DB.Tables.metadata.$inferSelect;
}
