PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scheduled_tasks_paused_state` (
	`task_id` integer PRIMARY KEY NOT NULL,
	`next_step_to_execute` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `scheduled_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_scheduled_tasks_paused_state`("task_id", "next_step_to_execute", "data") SELECT "task_id", "next_step_to_execute", "data" FROM `scheduled_tasks_paused_state`;--> statement-breakpoint
DROP TABLE `scheduled_tasks_paused_state`;--> statement-breakpoint
ALTER TABLE `__new_scheduled_tasks_paused_state` RENAME TO `scheduled_tasks_paused_state`;--> statement-breakpoint
PRAGMA foreign_keys=ON;