PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_stable_promotion_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`package_release_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decision_reason` text,
	FOREIGN KEY (`package_release_id`) REFERENCES `package_releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_stable_promotion_requests`("id", "package_release_id", "status", "decision_reason") SELECT "id", "package_release_id", "status", "decision_reason" FROM `stable_promotion_requests`;--> statement-breakpoint
DROP TABLE `stable_promotion_requests`;--> statement-breakpoint
ALTER TABLE `__new_stable_promotion_requests` RENAME TO `stable_promotion_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;