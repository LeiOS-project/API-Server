-- Stable promotion requests get a conversation and the statuses queued/released instead of approved.
-- Runs before 0033 drops `admin_note`.

-- The single admin note of a decided request becomes the first message of its conversation.
INSERT INTO `stable_promotion_request_messages` (`request_id`, `author_user_id`, `kind`, `status`, `body`, `created_at`)
SELECT `id`, NULL, 'status_change', CASE `status` WHEN 'approved' THEN 'queued' ELSE `status` END, COALESCE(`admin_note`, ''), `created_at`
FROM `stable_promotion_requests`
WHERE `status` IN ('approved', 'denied');--> statement-breakpoint

-- Approved releases still in the old pending list wait for the next OS release: they are queued.
UPDATE `stable_promotion_requests` SET `status` = 'queued'
WHERE `status` = 'approved' AND `package_release_id` IN (
	SELECT `value` FROM json_each(COALESCE((SELECT `data` FROM `metadata` WHERE `key` = 'os-release-pending-packages'), '[]'))
);--> statement-breakpoint

-- Every other approved release already went out with an OS release.
UPDATE `stable_promotion_requests` SET `status` = 'released' WHERE `status` = 'approved';--> statement-breakpoint

-- The queue now lives in stable_promotion_requests.
DELETE FROM `metadata` WHERE `key` = 'os-release-pending-packages';
