DROP VIEW IF EXISTS `packages_full_view`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_publishers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	`homepage_url` text NOT NULL,
	`owner_user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`maintainer_contact_name` text NOT NULL,
	`maintainer_contact_email` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_publishers`("id", "name", "display_name", "description", "homepage_url", "owner_user_id", "created_at", "maintainer_contact_name", "maintainer_contact_email") SELECT "id", "name", "display_name", "description", "homepage_url", "owner_user_id", "created_at", "maintainer_contact_name", "maintainer_contact_email" FROM `publishers`;--> statement-breakpoint
DROP TABLE `publishers`;--> statement-breakpoint
ALTER TABLE `__new_publishers` RENAME TO `publishers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `publishers_name_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `publishers_name_unique` ON `publishers` (`name`);--> statement-breakpoint
CREATE VIEW `packages_full_view` AS select "packages"."id", "packages"."publisher_id", "packages"."name", "publishers"."name" || '.' || "packages"."name" as "fullname", "packages"."top_level_alias", "packages"."display_name", "packages"."description", "packages"."homepage_url", "packages"."flags", "packages"."requires_patching", "packages"."created_at", "packages"."latest_stable_release", "packages"."latest_testing_release" from "packages" left join "publishers" on "packages"."publisher_id" = "publishers"."id";