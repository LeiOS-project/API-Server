-- Accounts that existed before self-service signup were all created by admins (or are the initial
-- admin), so their email addresses count as verified. Only touches rows that are still unverified,
-- so re-running it is harmless.
UPDATE `users` SET `email_verified_at` = `created_at` WHERE `email_verified_at` IS NULL;
