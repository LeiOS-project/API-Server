CREATE TABLE `os_release_packages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`os_release_id` integer NOT NULL,
	`package_release_id` integer,
	`package_fullname` text NOT NULL,
	`version_with_leios_patch` text NOT NULL,
	FOREIGN KEY (`os_release_id`) REFERENCES `os_releases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`package_release_id`) REFERENCES `package_releases`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `os_release_packages_os_release_idx` ON `os_release_packages` (`os_release_id`);--> statement-breakpoint
CREATE TABLE `stable_promotion_request_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`author_user_id` integer,
	`kind` text DEFAULT 'comment' NOT NULL,
	`status` text,
	`body` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `stable_promotion_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `stable_promotion_request_messages_request_idx` ON `stable_promotion_request_messages` (`request_id`);--> statement-breakpoint
ALTER TABLE `stable_promotion_requests` ADD `requested_by_user_id` integer;--> statement-breakpoint
ALTER TABLE `stable_promotion_requests` ADD `status_changed_at` integer;--> statement-breakpoint
ALTER TABLE `stable_promotion_requests` ADD `status_changed_by_user_id` integer;--> statement-breakpoint
ALTER TABLE `stable_promotion_requests` ADD `os_release_id` integer;--> statement-breakpoint
CREATE INDEX `stable_promotion_requests_status_idx` ON `stable_promotion_requests` (`status`);