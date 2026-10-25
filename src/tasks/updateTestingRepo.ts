import { TaskHandler } from "@cleverjs/utils";
import { AptlyAPI } from "../aptly/api";
import { BrandingBuilder } from "../utils/branding-builder";

interface Payload {
    changelogLines?: string[];
}

export const UpdateTestingRepoTask = new TaskHandler.BasicTaskFn("testing-repo:update", async (payload: Payload, logger) => {

    // Every upload and deletion queues this task. A later one that is already
    // queued publishes this change as well, so batches publish once.
    // (Imported here because ./index imports this module.)
    const { TaskQueueUtils } = await import("./index");
    if (!payload.changelogLines?.length && TaskQueueUtils.hasQueuedTask("testing-repo:update")) {
        logger.info("A later testing repo update is queued already; skipping this one.");
        return { success: true, message: "Superseded by a later queued testing repo update." };
    }

    const version = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const distribution = "testing";

    logger.info(`Building leios.system.branding-meta-files for testing repo (version ${version})...`);

    const debPath = await BrandingBuilder.buildBrandingPackage({
        version,
        distribution,
        changelogLines: payload.changelogLines,
    });

    logger.info(`Uploading branding package to archive repo: ${debPath}`);
    const brandingPackage = await AptlyAPI.Packages.uploadLocalDebIntoArchiveRepo(debPath);

    // Remove any previous branding package versions from testing so only the
    // newly built one remains (matching how normal package releases are replaced).
    logger.info(`Removing previous branding package versions from testing repo`);
    await AptlyAPI.Packages.deleteInRepo("leios-testing", brandingPackage.name);

    logger.info(`Copying ${brandingPackage.name} ${brandingPackage.version} into testing repo`);
    await AptlyAPI.Packages.copyIntoRepo("leios-testing", brandingPackage.name, brandingPackage.version, brandingPackage.architecture);

    await AptlyAPI.Publishing.updateLiveTestingRepo();

    // Drop packages that nothing references any more (e.g. after deletions).
    // Done once here rather than after every change.
    if (!await AptlyAPI.DB.cleanup()) {
        logger.warn("aptly db cleanup failed; unreferenced packages stay until the next testing repo update.");
    }

    logger.info("Testing repository updated successfully.");

    return { success: true };

});
