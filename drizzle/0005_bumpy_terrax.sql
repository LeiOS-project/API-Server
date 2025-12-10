ALTER TABLE `package_releases` RENAME COLUMN "version" TO "versionWithLeiosPatch";--> statement-breakpoint
ALTER TABLE `package_releases` DROP COLUMN `leios_patch`;