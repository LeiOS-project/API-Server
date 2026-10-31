PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scheduled_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`function` text NOT NULL,
	`tag` text NOT NULL,
	`created_by_user_id` integer,
	`args` text NOT NULL,
	`autoDelete` integer DEFAULT 0 NOT NULL,
	`storeLogs` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	`result` text,
	`message` text,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_scheduled_tasks`("id", "function", "tag", "created_by_user_id", "args", "autoDelete", "storeLogs", "status", "created_at", "finished_at", "result", "message") SELECT "id", "function", "tag", "created_by_user_id", "args", "autoDelete", "storeLogs", "status", "created_at", "finished_at", "result", "message" FROM `scheduled_tasks`;--> statement-breakpoint
DROP TABLE `scheduled_tasks`;--> statement-breakpoint
ALTER TABLE `__new_scheduled_tasks` RENAME TO `scheduled_tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;