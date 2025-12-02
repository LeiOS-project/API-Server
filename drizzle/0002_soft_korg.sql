CREATE TABLE `packages` (
	`name` text PRIMARY KEY NOT NULL,
	`owner_user_id` integer NOT NULL,
	`description` text NOT NULL,
	`homepage_url` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `users` ADD `display_name` text NOT NULL;