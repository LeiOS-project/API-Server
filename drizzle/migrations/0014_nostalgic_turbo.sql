PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_package_releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`package_id` integer NOT NULL,
	`versionWithLeiosPatch` text NOT NULL,
	`architectures` text DEFAULT '{"amd64": false, "arm64": false, "is_all": false}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`changelog` text NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `packages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint

INSERT INTO `__new_package_releases`(
	"id",
	"package_id",
	"versionWithLeiosPatch",
	"architectures",
	"created_at",
	"changelog"
) SELECT
	"id",
	"package_id",
	"versionWithLeiosPatch",
	json_object(
        'amd64', json(CASE WHEN EXISTS (SELECT 1 FROM json_each(architectures) WHERE value = 'amd64') THEN 'true' ELSE 'false' END),
        'arm64', json(CASE WHEN EXISTS (SELECT 1 FROM json_each(architectures) WHERE value = 'arm64') THEN 'true' ELSE 'false' END),
        'is_all', json('false')
    ),
	"created_at",
	"changelog"
FROM `package_releases`;--> statement-breakpoint

DROP TABLE `package_releases`;--> statement-breakpoint
ALTER TABLE `__new_package_releases` RENAME TO `package_releases`;--> statement-breakpoint
PRAGMA foreign_keys=ON;