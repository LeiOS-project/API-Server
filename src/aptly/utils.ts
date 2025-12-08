import { Logger } from "../utils/logger";
import fs from 'fs/promises';
import path from 'path';
import z from "zod";
import { AptlyAPIServer } from "./server";

export class AptlyUtils {

    static async downloadAptlyBinaryIfNeeded(aptlyBinaryPath: string) {
        try {

            const fileExists = await fs.access(aptlyBinaryPath).then(() => true).catch(() => false);
            if (fileExists) {
                return;
            }

            const latestRelease = await fetch("https://api.github.com/repos/aptly-dev/aptly/releases/latest");

            const releaseData = await latestRelease.json();

            const arch = process.arch === "x64" ? "amd64" : process.arch;

            let os = process.platform;

            const asset = releaseData.assets.find((asset: any) => asset.name.includes(`${os}_${arch}.zip`));

            if (!asset) {
                throw new Error("No suitable Aptly binary found for this architecture and OS.");
            }

            // make sure the target directory exists
            await fs.mkdir(path.dirname(aptlyBinaryPath), { recursive: true });

            const response = await Bun.fetch(asset.browser_download_url);

            const binName = asset.name.replace('.zip', '');

            if (!response.ok) {
                throw new Error("Failed to download Aptly binary.");
            }

            const file = Bun.file(`/tmp/aptly-download.zip`);
            const archiveBuffer = await response.arrayBuffer();
            await Bun.write(file, archiveBuffer);
            await Bun.$`unzip -o /tmp/aptly-download.zip -d /tmp/aptly-archive`.text();

            await fs.copyFile(`/tmp/aptly-archive/${binName}/aptly`, aptlyBinaryPath);
            await fs.chmod(aptlyBinaryPath, 0o755);

            await fs.rm(`/tmp/aptly-archive`, { recursive: true });
            await fs.rm(`/tmp/aptly-download.zip`, { recursive: true });

            Logger.info(`Aptly binary downloaded to ${aptlyBinaryPath}`);

        } catch (error) {
            throw new Error("Failed to fetch latest Aptly release: " + error);
        }
    }

    static forwardAptlyOutput(stream: ReadableStream<Uint8Array> | null, logFn: (message: string) => void) {
        if (!stream) return;

        const decoder = new TextDecoder();
        const reader = stream.getReader();
        let buffer = "";

        const emitLine = (rawLine: string) => {
            const line = rawLine.replace(/\r$/, "");
            if (line.startsWith("[GIN]")) return; // skip gin logs
            logFn(line);
        };

        const pump = async () => {
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });

                    let newlineIndex: number;
                    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
                        const line = buffer.slice(0, newlineIndex);
                        buffer = buffer.slice(newlineIndex + 1);
                        emitLine(line);
                    }
                }

                const remainder = buffer + decoder.decode();
                if (remainder) {
                    emitLine(remainder);
                }
            } catch (error) {
                Logger.warn("Failed to read Aptly output:", error);
            }
        };

        pump();
    }

    static async createDefaultRepositoriesIfNeeded() {

        try {

            const existReposResponse = (await AptlyAPIServer.getClient().getApiRepos({}));

            if (!existReposResponse.data) {
                throw new Error("Failed to fetch existing repositories: " + existReposResponse.error);
            }
            const existingRepos = existReposResponse.data;

            if (!existingRepos.some(repo => repo.Name === "leios-stable")) {
                await AptlyAPIServer.getClient().postApiRepos({
                    body: {
                        Name: "leios-stable",
                        DefaultComponent: "main",
                        DefaultDistribution: "stable"
                    }
                });

                Logger.info("Repository 'leios-stable' created.");
            }

            if (!existingRepos.some(repo => repo.Name === "leios-testing")) {
                await AptlyAPIServer.getClient().postApiRepos({
                    body: {
                        Name: "leios-testing",
                        DefaultComponent: "main",
                        DefaultDistribution: "testing"
                    }
                });

                Logger.info("Repository 'leios-testing' created.");
            }

            // the archive repo is not published by default, its just to hold every package version in history
            if (!existingRepos.some(repo => repo.Name === "leios-archive")) {
                await AptlyAPIServer.getClient().postApiRepos({
                    body: {
                        Name: "leios-archive",
                        DefaultComponent: "main",
                        DefaultDistribution: "archive"
                    }
                });

                Logger.info("Repository 'leios-archive' created.");
            }

        } catch (error) {
            throw new Error("Failed to create default repositories: " + error);
        }

    }

    static async initialRepoPublishIfNeeded() {

        try {

            const existingPublishedReposResult = await AptlyAPIServer.getClient().getApiPublish({});
            if (!existingPublishedReposResult.data) {
                throw new Error("Failed to fetch existing published repositories: " + existingPublishedReposResult.error);
            }
            const existingPublishedRepos = existingPublishedReposResult.data;

            if (!existingPublishedRepos.some(pub => pub.Storage === "s3:leios-live-repo" && pub.Distribution === "testing")) {
                const testingPublishResult = await AptlyAPIServer.getClient().postApiPublishByPrefix({
                    path: {
                        prefix: "s3:leios-live-repo",
                    },
                    body: {
                        SourceKind: "local",
                        Sources: [
                            {
                                Name: "leios-testing",
                                Component: "main"
                            }
                        ],
                        Distribution: "testing"
                    }
                });

                Logger.info("Pubklished initial state of 'leios-testing' repository.");
                if (!testingPublishResult.data) {
                    throw new Error("Failed to publish 'leios-testing' repository: " + testingPublishResult.error);
                }
            }

            if (!existingPublishedRepos.some(pub => pub.Storage === "s3:leios-live-repo" && pub.Distribution === "stable")) {
                const createSnapshotResult = await AptlyAPIServer.getClient().postApiReposByNameSnapshots({
                    path: {
                        name: "leios-stable"
                    },
                    body: {
                        Name: `leios-stable-0000.00.0`,
                        Description: "Initial stable snapshot. This snapshot is empty.",
                    }
                });
                if (!createSnapshotResult.data) {
                    throw new Error("Failed to create initial snapshot for 'leios-stable' repository: " + createSnapshotResult.error);
                }

                const stablePublishResult = await AptlyAPIServer.getClient().postApiPublishByPrefix({
                    path: {
                        prefix: "s3:leios-live-repo",
                    },
                    body: {
                        SourceKind: "snapshot",
                        Sources: [
                            {
                                Name: "leios-stable-0000.00.0",
                                Component: "main"
                            }
                        ],
                        Distribution: "stable"
                    }
                });

                Logger.info("Published initial state of 'leios-stable' repository.");

                if (!stablePublishResult.data) {
                    throw new Error("Failed to publish 'leios-stable' repository: " + stablePublishResult.error);
                }
            }


        } catch (error: any) {
            throw new Error("Failed to perform initial repository publish: " + error.message);
        }

    }

    static extractVersionAndPatchSuffix(fullVersion: string) {
        const leiosSuffixMatch = fullVersion.match(/(.*)leios(\d+)$/);
        if (leiosSuffixMatch) {
            return {
                version: leiosSuffixMatch[1],
                leios_patch: parseInt(leiosSuffixMatch[2])
            };
        } else {
            return {
                version: fullVersion,
                leios_patch: undefined
            };
        }
    }



    static buildVersionWithLeiOSSuffix(version: string, leios_patch?: string | null) {
        if (leios_patch) {
            if (version.endsWith(`leios${leios_patch}`)) {
                return version;
            }
            return version + `leios${leios_patch}`;
        }
        return version;
    }

    static getPackageIdentifier(packageName: string, fullPackageVersion: string, architecture: string): string;
    static getPackageIdentifier(packageName: string, packageVersion: string, leios_patch: string | null | undefined, architecture: string): string;
    static getPackageIdentifier(packageName: string, versionOrFullVersion: string, leios_patchOrArch: string | null | undefined, architectureOpt?: string) {

        let fullPackageVersion: string;

        if (architectureOpt) {
            // Called with (packageName, packageVersion, leios_patch, architecture)
            fullPackageVersion = this.buildVersionWithLeiOSSuffix(versionOrFullVersion, leios_patchOrArch);
        } else {
            // Called with (packageName, fullPackageVersion, architecture)
            fullPackageVersion = versionOrFullVersion;
        }

        const architecture = architectureOpt ? architectureOpt : leios_patchOrArch!;

        return `${packageName}_${fullPackageVersion}_${architecture}`;
    }

}
