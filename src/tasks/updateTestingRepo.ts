import { TaskHandler } from "@cleverjs/utils";
import { AptlyAPI } from "../aptly/api";
import { BrandingBuilder } from "../utils/branding-builder";

interface Payload {
    changelogLines?: string[];
}

export const UpdateTestingRepoTask = new TaskHandler.BasicTaskFn("testing-repo:update", async (payload: Payload, logger) => {

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

    const existsInTesting = await AptlyAPI.Packages.existsInRepo(
        "leios-testing",
        brandingPackage.name,
        brandingPackage.version,
        brandingPackage.architecture
    );

    if (!existsInTesting) {
        logger.info(`Copying ${brandingPackage.name} ${brandingPackage.version} into testing repo`);
        await AptlyAPI.Packages.copyIntoRepo("leios-testing", brandingPackage.name, brandingPackage.version, brandingPackage.architecture);
    } else {
        logger.info(`Branding package already exists in testing repo, skipping copy`);
    }

    await AptlyAPI.Publishing.updateLiveTestingRepo();

    logger.info("Testing repository updated successfully.");

    return { success: true };

});
