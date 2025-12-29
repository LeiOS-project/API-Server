PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_os_releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` text NOT NULL,
	`changelog` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`taskID` integer NOT NULL,
	FOREIGN KEY (`taskID`) REFERENCES `scheduled_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_os_releases`("id", "version", "changelog", "created_at", "taskID") SELECT "id", "version", "changelog", "created_at", "taskID" FROM `os_releases`;--> statement-breakpoint
DROP TABLE `os_releases`;--> statement-breakpoint
ALTER TABLE `__new_os_releases` RENAME TO `os_releases`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `os_releases_version_unique` ON `os_releases` (`version`);