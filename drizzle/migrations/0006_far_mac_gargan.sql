ALTER TABLE `os_releases` ADD `taskID` integer NOT NULL REFERENCES scheduled_tasks(id);--> statement-breakpoint
ALTER TABLE `os_releases` DROP COLUMN `published_at`;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` DROP COLUMN `tag`;