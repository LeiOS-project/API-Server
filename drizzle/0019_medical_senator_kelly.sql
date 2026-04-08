PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_packages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`publisher_id` integer NOT NULL,
	`name` text NOT NULL,
	`topLevelAlias` text,
	`display_name` text NOT NULL,
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
INSERT INTO `__new_packages`("id", "publisher_id", "name", "topLevelAlias", "display_name", "description", "homepage_url", "flags", "requires_patching", "created_at", "latest_stable_release", "latest_testing_release") SELECT "id", "publisher_id", "name", "topLevelAlias", "display_name", "description", "homepage_url", "flags", "requires_patching", "created_at", "latest_stable_release", "latest_testing_release" FROM `packages`;--> statement-breakpoint
DROP TABLE `packages`;--> statement-breakpoint
ALTER TABLE `__new_packages` RENAME TO `packages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `packages_topLevelAlias_unique` ON `packages` (`topLevelAlias`);--> statement-breakpoint
CREATE INDEX `packages_publisher_id_idx` ON `packages` (`publisher_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `packages_publisher_id_name_unique` ON `packages` (`publisher_id`,`name`);