ALTER TABLE `api_keys` ADD `created_at` integer DEFAULT 1765904964626 NOT NULL;--> statement-breakpoint
ALTER TABLE `os_releases` ADD `created_at` integer DEFAULT 1765904964626 NOT NULL;--> statement-breakpoint
ALTER TABLE `package_releases` ADD `created_at` integer DEFAULT 1765904964626 NOT NULL;--> statement-breakpoint
ALTER TABLE `packages` ADD `created_at` integer DEFAULT 1765904964626 NOT NULL;--> statement-breakpoint
ALTER TABLE `password_resets` ADD `created_at` integer DEFAULT 1765904964626 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `created_at` integer DEFAULT 1765904964626 NOT NULL;--> statement-breakpoint
ALTER TABLE `stable_promotion_requests` ADD `created_at` integer DEFAULT 1765904964626 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `created_at` integer DEFAULT 1765904964625 NOT NULL;