PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`hashed_token` text NOT NULL,
	`user_id` integer NOT NULL,
	`user_role` text NOT NULL,
	`description` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_role`) REFERENCES `users`(`role`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_api_keys`("id", "hashed_token", "user_id", "user_role", "description", "created_at", "expires_at") SELECT "id", "hashed_token", "user_id", "user_role", "description", "created_at", "expires_at" FROM `api_keys`;--> statement-breakpoint
DROP TABLE `api_keys`;--> statement-breakpoint
ALTER TABLE `__new_api_keys` RENAME TO `api_keys`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_os_releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`published_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_os_releases`("id", "version", "created_at", "published_at") SELECT "id", "version", "created_at", "published_at" FROM `os_releases`;--> statement-breakpoint
DROP TABLE `os_releases`;--> statement-breakpoint
ALTER TABLE `__new_os_releases` RENAME TO `os_releases`;--> statement-breakpoint
CREATE UNIQUE INDEX `os_releases_version_unique` ON `os_releases` (`version`);--> statement-breakpoint
CREATE TABLE `__new_package_releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`package_id` integer NOT NULL,
	`versionWithLeiosPatch` text NOT NULL,
	`architecture` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_package_releases`("id", "package_id", "versionWithLeiosPatch", "architecture", "created_at") SELECT "id", "package_id", "versionWithLeiosPatch", "architecture", "created_at" FROM `package_releases`;--> statement-breakpoint
DROP TABLE `package_releases`;--> statement-breakpoint
ALTER TABLE `__new_package_releases` RENAME TO `package_releases`;--> statement-breakpoint
CREATE TABLE `__new_packages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` integer NOT NULL,
	`description` text NOT NULL,
	`homepage_url` text NOT NULL,
	`requires_patching` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`latest_stable_release_amd64` text,
	`latest_stable_release_arm64` text,
	`latest_testing_release_amd64` text,
	`latest_testing_release_arm64` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_packages`("id", "name", "owner_user_id", "description", "homepage_url", "requires_patching", "created_at", "latest_stable_release_amd64", "latest_stable_release_arm64", "latest_testing_release_amd64", "latest_testing_release_arm64") SELECT "id", "name", "owner_user_id", "description", "homepage_url", "requires_patching", "created_at", "latest_stable_release_amd64", "latest_stable_release_arm64", "latest_testing_release_amd64", "latest_testing_release_arm64" FROM `packages`;--> statement-breakpoint
DROP TABLE `packages`;--> statement-breakpoint
ALTER TABLE `__new_packages` RENAME TO `packages`;--> statement-breakpoint
CREATE UNIQUE INDEX `packages_name_unique` ON `packages` (`name`);--> statement-breakpoint
CREATE TABLE `__new_password_resets` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_password_resets`("token", "user_id", "created_at", "expires_at") SELECT "token", "user_id", "created_at", "expires_at" FROM `password_resets`;--> statement-breakpoint
DROP TABLE `password_resets`;--> statement-breakpoint
ALTER TABLE `__new_password_resets` RENAME TO `password_resets`;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`hashed_token` text NOT NULL,
	`user_id` integer NOT NULL,
	`user_role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_role`) REFERENCES `users`(`role`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "hashed_token", "user_id", "user_role", "created_at", "expires_at") SELECT "id", "hashed_token", "user_id", "user_role", "created_at", "expires_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
CREATE TABLE `__new_stable_promotion_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`package_id` integer NOT NULL,
	`package_release_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`admin_note` text,
	FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`package_release_id`) REFERENCES `package_releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_stable_promotion_requests`("id", "package_id", "package_release_id", "status", "created_at", "admin_note") SELECT "id", "package_id", "package_release_id", "status", "created_at", "admin_note" FROM `stable_promotion_requests`;--> statement-breakpoint
DROP TABLE `stable_promotion_requests`;--> statement-breakpoint
ALTER TABLE `__new_stable_promotion_requests` RENAME TO `stable_promotion_requests`;--> statement-breakpoint
CREATE UNIQUE INDEX `stable_promotion_requests_package_release_id_unique` ON `stable_promotion_requests` (`package_release_id`);--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "created_at", "username", "display_name", "email", "password_hash", "role") SELECT "id", "created_at", "username", "display_name", "email", "password_hash", "role" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);