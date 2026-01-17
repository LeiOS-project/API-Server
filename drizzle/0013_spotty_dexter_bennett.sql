-- Custom SQL migration file, put your code below! --
ALTER TABLE `packages` ADD `latest_stable_release` text DEFAULT '{"amd64": null, "arm64": null}';--> statement-breakpoint
ALTER TABLE `packages` ADD `latest_testing_release` text DEFAULT '{"amd64": null, "arm64": null}';--> statement-breakpoint

UPDATE `packages` SET `latest_stable_release` = json_object(
    'amd64', `latest_stable_release_amd64`, 
    'arm64', `latest_stable_release_arm64`
);--> statement-breakpoint

UPDATE `packages` SET `latest_testing_release` = json_object(
    'amd64', `latest_testing_release_amd64`, 
    'arm64', `latest_testing_release_arm64`
);--> statement-breakpoint

ALTER TABLE `packages` DROP COLUMN `latest_stable_release_amd64`;--> statement-breakpoint
ALTER TABLE `packages` DROP COLUMN `latest_stable_release_arm64`;--> statement-breakpoint
ALTER TABLE `packages` DROP COLUMN `latest_testing_release_amd64`;--> statement-breakpoint
ALTER TABLE `packages` DROP COLUMN `latest_testing_release_arm64`;
-- End of custom SQL migration file. --