ALTER TABLE `tmp_data` RENAME TO `metadata`;--> statement-breakpoint
ALTER TABLE `stable_promotion_requests` RENAME COLUMN "decision_reason" TO "admin_note";--> statement-breakpoint
ALTER TABLE `metadata` DROP COLUMN `expires_at`;