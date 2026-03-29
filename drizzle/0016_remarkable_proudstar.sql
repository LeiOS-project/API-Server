CREATE TABLE `publisher_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publisher_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`publisher_id`) REFERENCES `publishers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publisher_members_user_id_publisher_id_unique` ON `publisher_members` (`user_id`,`publisher_id`);--> statement-breakpoint
CREATE TABLE `publishers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	`homepage_url` text,
	`owner_user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publishers_name_unique` ON `publishers` (`name`);--> statement-breakpoint
CREATE TABLE `role_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`package_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_assignments_user_id_package_id_unique` ON `role_assignments` (`user_id`,`package_id`);--> statement-breakpoint
INSERT INTO `publishers` (`name`, `display_name`, `description`, `owner_user_id`, `created_at`) SELECT `username`, `display_name`, 'Personal publisher for ' || `display_name`, `id`, `created_at` FROM `users`;--> statement-breakpoint
INSERT INTO `publisher_members` (`publisher_id`, `user_id`, `role`, `created_at`) SELECT `id`, `owner_user_id`, 'admin', `created_at` FROM `publishers`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_packages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publisher_id` integer NOT NULL,
	`name` text NOT NULL,
	`topLevelAlias` text,
	`description` text NOT NULL,
	`homepage_url` text NOT NULL,
	`flags` text DEFAULT '[]' NOT NULL,
	`requires_patching` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`latest_stable_release` text DEFAULT '{"amd64": null, "arm64": null}' NOT NULL,
	`latest_testing_release` text DEFAULT '{"amd64": null, "arm64": null}' NOT NULL,
	FOREIGN KEY (`publisher_id`) REFERENCES `publishers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_packages`("id", "publisher_id", "name", "topLevelAlias", "description", "homepage_url", "flags", "requires_patching", "created_at", "latest_stable_release", "latest_testing_release") SELECT p.`id`, pub.`id`, p.`name`, NULL, p.`description`, p.`homepage_url`, p.`flags`, p.`requires_patching`, p.`created_at`, p.`latest_stable_release`, p.`latest_testing_release` FROM `packages` p LEFT JOIN `publishers` pub ON pub.`owner_user_id` = p.`owner_user_id`;--> statement-breakpoint
DROP TABLE `packages`;--> statement-breakpoint
ALTER TABLE `__new_packages` RENAME TO `packages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `packages_topLevelAlias_unique` ON `packages` (`topLevelAlias`);--> statement-breakpoint
CREATE INDEX `packages_publisher_id_idx` ON `packages` (`publisher_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `packages_publisher_id_name_unique` ON `packages` (`publisher_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `package_releases_pkg_version_unique` ON `package_releases` (`package_id`,`versionWithLeiosPatch`);--> statement-breakpoint
CREATE VIEW `package_full_view` AS select "packages"."id", "packages"."publisher_id", "packages"."name", "publishers"."name" || '.' || "packages"."name" as "fullname", "packages"."topLevelAlias", "packages"."description", "packages"."homepage_url", "packages"."flags", "packages"."requires_patching", "packages"."created_at", "packages"."latest_stable_release", "packages"."latest_testing_release" from "packages" left join "publishers" on "packages"."publisher_id" = "publishers"."id";