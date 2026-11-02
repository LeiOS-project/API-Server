ALTER TABLE `packages` ADD `display_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `packages` SET `display_name` = `name` WHERE `display_name` = '';