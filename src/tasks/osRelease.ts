import { TaskHandler } from "@cleverjs/utils";
import { DB } from "../db";
import { eq } from "drizzle-orm";
import { AptlyAPI } from "../aptly/api";

interface Payload {
    pkgReleasesToIncludeByID: number[];
    version: string;
    timestamp: number;
}
interface StepState {
    nextPackageIndexToMove: number;
}


export const OsReleaseTask = new TaskHandler.StepBasedTaskFn("os-release:create", async (payload: Payload, logger, state: StepState) => {

    state.nextPackageIndexToMove = 0;

    return { success: true };
});

OsReleaseTask.addStep("Move packages from archive to local stable repo", async (payload, logger, state, isPaused) => {

    for (; state.nextPackageIndexToMove < payload.pkgReleasesToIncludeByID.length; state.nextPackageIndexToMove++) {

        let pkgName = "UNKNOWN";
        let pkgReleaseVersion = "UNKNOWN";

        try {

            if (isPaused.valueOf()) {
                logger.info("Pausing First Long Step at index", state.nextPackageIndexToMove);
                return { success: true, paused: true };
            }

            const pkgReleaseID = payload.pkgReleasesToIncludeByID[state.nextPackageIndexToMove];

            if (!pkgReleaseID) {
                logger.error("Invalid package release ID at index", state.nextPackageIndexToMove, ", skipping.");
                continue;
            }

            const result = await DB.instance().transaction(async (tx) => {

                const release = tx.select().from(DB.Schema.packageReleases).where(
                    eq(DB.Schema.packageReleases.id, pkgReleaseID)
                ).get();

                if (!release) {
                    logger.error(`Package release with ID ${pkgReleaseID} not found, skipping.`);
                    tx.rollback()
                    return false;
                }

                const packageData = tx.select().from(DB.Schema.packages).where(
                    eq(DB.Schema.packages.id, release.package_id)
                ).get();

                if (!packageData?.name) {
                    logger.error(`Package with ID ${release.package_id} not found for release ID ${pkgReleaseID}, skipping.`);
                    tx.rollback()
                    return false;
                }

                pkgName = packageData.name;
                pkgReleaseVersion = release.versionWithLeiosPatch;

                if (release.architectures.is_all) {

                    if (!release.architectures.amd64 || !release.architectures.arm64) {
                        logger.error(`Release ID ${pkgReleaseID} marked as 'all' architectures but missing specific architectures, skipping.`);
                        tx.rollback()
                        return false;
                    }

                    // delete in stable for this package first
                    await AptlyAPI.Packages.deleteInRepo("leios-stable", packageData.name);

                    await AptlyAPI.Packages.copyIntoRepo("leios-stable", packageData.name, release.versionWithLeiosPatch, "all");

                    packageData.latest_stable_release = {
                        amd64: release.versionWithLeiosPatch,
                        arm64: release.versionWithLeiosPatch
                    };

                } else {

                    if (release.architectures.amd64) {

                        // delete in stable for this package first but ensure we only delete for this architecture
                        await AptlyAPI.Packages.deleteInRepo("leios-stable", packageData.name, undefined, "amd64");

                        await AptlyAPI.Packages.copyIntoRepo("leios-stable", packageData.name, release.versionWithLeiosPatch, "amd64");

                        packageData.latest_stable_release.amd64 = release.versionWithLeiosPatch;
                    }
                    if (release.architectures.arm64) {

                        // delete in stable for this package first but ensure we only delete for this architecture
                        await AptlyAPI.Packages.deleteInRepo("leios-stable", packageData.name, undefined, "arm64");

                        await AptlyAPI.Packages.copyIntoRepo("leios-stable", packageData.name, release.versionWithLeiosPatch, "arm64");

                        packageData.latest_stable_release.arm64 = release.versionWithLeiosPatch;
                    }

                }

                await tx.update(DB.Schema.packages).set({
                    latest_stable_release: packageData.latest_stable_release
                }).where(
                    eq(DB.Schema.packages.id, packageData.id)
                );

                return true;
            });

            if (!result) {
                continue;
            }

            logger.info(`Successfully moved package ${pkgName} version ${pkgReleaseVersion} to local stable repo.`);

        } catch (err) {
            logger.error("Error moving package release ID", payload.pkgReleasesToIncludeByID[state.nextPackageIndexToMove], ":", err);
        }
    }

    return { success: true };

});

// OsReleaseTask.addStep("Record OS release data to database", async (payload, logger) => {

//     try {

//         await DB.instance().insert(DB.Schema.os_releases).values({
//             version: payload.version,
//             // @TODO: link task ID properly
//         });

//         logger.info("OS release data recorded in database:", payload.version);
//         return { success: true };

//     } catch (err) {
//         logger.error("Error recording OS release data:", err);
//         return { success: false, message: Error.isError(err) ? err.message : "Unknown error" };
//     }

// });

OsReleaseTask.addStep("Create OS release snapshot", async (payload, logger) => {

    try {
        const snapshotName = `leios-stable-${payload.version}`;
        const snapshotResult = await AptlyAPI.Snapshots.createSnapshotOfRepo("leios-stable", snapshotName, "LeiOS Release");

        if (!snapshotResult) {
            logger.error("Failed to create snapshot for OS release");
            return { success: false, message: "Failed to create snapshot" };
        }

        logger.info("OS release snapshot created:", snapshotName);
        return { success: true };

    } catch (err) {
        logger.error("Error creating OS release snapshot:", err);
        return { success: false, message: Error.isError(err) ? err.message : "Unknown error" };
    }

});

OsReleaseTask.addStep("Publish OS release snapshot to S3", async (payload, logger) => {

    try {
        const snapshotName = `leios-stable-${payload.version}`;
        const publishResult = await AptlyAPI.Publishing.publishReleaseSnapshotToLiveStable(payload.version);

        if (!publishResult) {
            logger.error("Failed to publish OS release snapshot to live stable repo");
            return { success: false, message: "Failed to publish snapshot" };
        }

        logger.info("OS release published to live stable repo from snapshot:", snapshotName);
        return { success: true };

    } catch (err) {
        logger.error("Error publishing OS release snapshot:", err);
        return { success: false, message: Error.isError(err) ? err.message : "Unknown error" };
    }

});

OsReleaseTask.addStep("Finalize OS release", async (payload, logger) => {

    logger.info("OS release process completed successfully for version", payload.version);

    return { success: true };

});
