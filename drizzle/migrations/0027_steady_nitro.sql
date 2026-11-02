ALTER TABLE `publishers` ADD `maintainer_contact_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `publishers` ADD `maintainer_contact_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Backfill empty maintainer contact fields with the publisher owner's info
UPDATE `publishers` SET `maintainer_contact_name` = (SELECT `display_name` FROM `users` WHERE `users`.`id` = `publishers`.`owner_user_id`) WHERE `maintainer_contact_name` = '';--> statement-breakpoint
UPDATE `publishers` SET `maintainer_contact_email` = (SELECT `email` FROM `users` WHERE `users`.`id` = `publishers`.`owner_user_id`) WHERE `maintainer_contact_email` = '';