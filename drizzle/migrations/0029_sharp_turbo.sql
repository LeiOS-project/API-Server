CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` integer,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`target_label` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_target_idx` ON `audit_log` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `email_verifications` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`email` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reporter_user_id` integer,
	`target_type` text NOT NULL,
	`target_id` integer NOT NULL,
	`target_label` text NOT NULL,
	`reason` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution_note` text,
	`resolved_by_user_id` integer,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `reports` (`status`);--> statement-breakpoint
ALTER TABLE `packages` ADD `moderation_note` text;--> statement-breakpoint
ALTER TABLE `publishers` ADD `verified_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `suspended_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `suspended_reason` text;--> statement-breakpoint
DROP VIEW `packages_full_view`;--> statement-breakpoint
CREATE VIEW `packages_full_view` AS select "packages"."id", "packages"."publisher_id", "packages"."name", "publishers"."name" || '.' || "packages"."name" as "fullname", "packages"."top_level_alias", "packages"."display_name", "packages"."description", "packages"."homepage_url", "packages"."flags", "packages"."moderation_note", "packages"."requires_patching", "packages"."created_at", (select max("package_releases"."created_at") from "package_releases" where "package_releases"."package_id" = "packages"."id") as "last_release_at", "publishers"."display_name" as "publisher_display_name", "publishers"."verified_at" as "publisher_verified_at", "packages"."latest_stable_release", "packages"."latest_testing_release" from "packages" left join "publishers" on "packages"."publisher_id" = "publishers"."id";