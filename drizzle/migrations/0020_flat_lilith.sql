ALTER TABLE `package_releases` RENAME COLUMN "versionWithLeiosPatch" TO "version_with_leios_patch";--> statement-breakpoint
ALTER TABLE `packages` RENAME COLUMN "topLevelAlias" TO "top_level_alias";--> statement-breakpoint
DROP INDEX `package_releases_pkg_version_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `package_releases_pkg_version_unique` ON `package_releases` (`package_id`,`version_with_leios_patch`);--> statement-breakpoint
DROP INDEX `packages_topLevelAlias_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `packages_top_level_alias_unique` ON `packages` (`top_level_alias`);--> statement-breakpoint
DROP VIEW `packages_full_view`;--> statement-breakpoint
CREATE VIEW `packages_full_view` AS select "packages"."id", "packages"."publisher_id", "packages"."name", "publishers"."name" || '.' || "packages"."name" as "fullname", "packages"."top_level_alias", "packages"."display_name", "packages"."description", "packages"."homepage_url", "packages"."flags", "packages"."requires_patching", "packages"."created_at", "packages"."latest_stable_release", "packages"."latest_testing_release" from "packages" left join "publishers" on "packages"."publisher_id" = "publishers"."id";