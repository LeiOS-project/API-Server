CREATE TABLE `os_releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `os_releases_version_unique` ON `os_releases` (`version`);--> statement-breakpoint
CREATE TABLE `scheduled_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_type` text NOT NULL,
	`trigger` text NOT NULL,
	`function` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`result` text,
	`created_at` integer,
	`updated_at` integer,
	`started_at` integer,
	`completed_at` integer
);
