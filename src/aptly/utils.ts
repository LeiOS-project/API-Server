import fs from "fs/promises";
import path from "path";
import { Logger } from "../utils/logger";
import { AptlyAPIServer } from "./server";

export class AptlyUtils {
    private static async delay(ms: number) {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    static async ensureDirExists(dirPath: string) {
        await fs.mkdir(dirPath, { recursive: true });
    }

    static async removePathIfExists(targetPath: string) {
        await fs.rm(targetPath, { recursive: true, force: true });
    }

    static async downloadAptlyBinaryIfNeeded(aptlyBinaryPath: string) {
        const fileExists = await fs.access(aptlyBinaryPath).then(() => true).catch(() => false);
        if (fileExists) return;

        const releaseResponse = await fetch("https://api.github.com/repos/aptly-dev/aptly/releases/latest");
        if (!releaseResponse.ok) {
            throw new Error(`GitHub release request failed with status ${releaseResponse.status}`);
        }
        const releaseData = await releaseResponse.json();

        const arch = process.arch === "x64" ? "amd64" : process.arch;
        const os = process.platform;
        const asset = releaseData.assets?.find((candidate: any) => candidate.name && candidate.name.includes(`${os}_${arch}.zip`));
        if (!asset) {
            throw new Error("No suitable Aptly binary found for this architecture and OS.");
        }

        await this.ensureDirExists(path.dirname(aptlyBinaryPath));

        const tmpArchiveDir = `/tmp/aptly-archive`;
        const tmpZipPath = `/tmp/aptly-download.zip`;
        const binName = asset.name.replace(".zip", "");

        try {
            const downloadResponse = await Bun.fetch(asset.browser_download_url);
            if (!downloadResponse.ok) {
                throw new Error(`Failed to download Aptly binary: status ${downloadResponse.status}`);
            }

            const archiveBuffer = await downloadResponse.arrayBuffer();
            await Bun.write(Bun.file(tmpZipPath), archiveBuffer);
            await Bun.$`unzip -o ${tmpZipPath} -d ${tmpArchiveDir}`.text();

            await fs.copyFile(`${tmpArchiveDir}/${binName}/aptly`, aptlyBinaryPath);
            await fs.chmod(aptlyBinaryPath, 0o755);

            Logger.info(`Aptly binary downloaded to ${aptlyBinaryPath}`);
        } catch (error) {
            await this.removePathIfExists(aptlyBinaryPath);
            throw new Error(`Failed to fetch latest Aptly release: ${error}`);
        } finally {
            await this.removePathIfExists(tmpArchiveDir);
            await this.removePathIfExists(tmpZipPath);
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
        const existReposResponse = await AptlyAPIServer.getClient().getApiRepos({});
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
    }

    static async initialRepoPublishIfNeeded() {

        const publishPrefix = "s3:leios-live-repo:";

        const existingPublishedReposResult = await AptlyAPIServer.getClient().getApiPublish({});
        if (!existingPublishedReposResult.data) {
            throw new Error("Failed to fetch existing published repositories: " + existingPublishedReposResult.error.error);
        }
        const existingPublishedRepos = existingPublishedReposResult.data;

        if (!existingPublishedRepos.some(pub => pub.Storage === "s3:leios-live-repo" && pub.Distribution === "testing")) {
            const testingPublishResult = await AptlyAPIServer.getClient().postApiPublishByPrefix({
                path: {
                    prefix: publishPrefix,
                },
                body: {
                    SourceKind: "local",
                    Sources: [
                        {
                            Name: "leios-testing",
                            Component: "main"
                        }
                    ],
                    Distribution: "testing",
                    Architectures: [
                        "amd64",
                        "arm64"
                    ],
                    Signing: AptlyAPIServer.SigningConfig
                }
            });

            Logger.info("Published initial state of 'leios-testing' repository.");
            if (!testingPublishResult.data) {
                throw new Error("Failed to publish 'leios-testing' repository: " + testingPublishResult.error.error);
            }
        }

        if (!existingPublishedRepos.some(pub => pub.Storage === "s3:leios-live-repo" && pub.Distribution === "stable")) {
            const createSnapshotResult = await AptlyAPIServer.getClient().postApiReposByNameSnapshots({
                path: {
                    name: "leios-stable"
                },
                body: {
                    Name: "leios-stable-0000.00.0",
                    Description: "Initial stable snapshot. This snapshot is empty.",
                }
            });
            if (!createSnapshotResult.data) {
                const errMsg = createSnapshotResult.error?.error || "";
                if (errMsg.includes("already exists")) {
                    Logger.info("Initial 'leios-stable-0000.00.0' snapshot already exists, skipping creation.");
                } else {
                    throw new Error("Failed to create initial snapshot for 'leios-stable' repository: " + errMsg);
                }
            }

            const stablePublishResult = await AptlyAPIServer.getClient().postApiPublishByPrefix({
                path: {
                    prefix: publishPrefix,
                },
                body: {
                    SourceKind: "snapshot",
                    Sources: [
                        {
                            Name: "leios-stable-0000.00.0",
                            Component: "main"
                        }
                    ],
                    Distribution: "stable",
                    Architectures: [
                        "amd64",
                        "arm64"
                    ],
                    Signing: AptlyAPIServer.SigningConfig
                }
            });

            Logger.info("Published initial state of 'leios-stable' repository.");

            if (!stablePublishResult.data) {
                throw new Error("Failed to publish 'leios-stable' repository: " + stablePublishResult.error.error);
            }
        }
    }

    static extractVersionAndPatchSuffix(fullVersion: string) {
        // Allow up to four numeric segments in the leios suffix (e.g. leios1, leios1.2.3.4)
        const leiosSuffixMatch = fullVersion.match(/(.*)leios(\d+(?:\.\d+){0,2})$/);
        if (leiosSuffixMatch) {
            return {
                version: leiosSuffixMatch[1],
                leios_patch: leiosSuffixMatch[2]
            };
        }
        return {
            version: fullVersion,
            leios_patch: undefined
        };
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
        const fullPackageVersion = architectureOpt
            ? this.buildVersionWithLeiOSSuffix(versionOrFullVersion, leios_patchOrArch)
            : versionOrFullVersion;

        const architecture = architectureOpt ? architectureOpt : leios_patchOrArch!;
        return `${packageName}_${fullPackageVersion}_${architecture}`;
    }

    static async waitForAptlyReady(baseUrl: string, timeoutMs = 10_000, pollMs = 300) {
        const deadline = Date.now() + timeoutMs;
        let lastError = "";

        while (Date.now() < deadline) {
            try {
                const response = await fetch(`${baseUrl}/api/version`);
                if (response.ok) return;
                lastError = `status ${response.status}`;
            } catch (error: any) {
                lastError = error?.message || String(error);
            }
            await this.delay(pollMs);
        }

        throw new Error(`Aptly API not reachable after ${timeoutMs}ms: ${lastError}`);
    }

}

export namespace AptlyUtils.Signing {

    async function ensureBinaryGpgKeyring(sourcePath: string, outputPath: string) {
        const fileExists = await fs.access(sourcePath).then(() => true).catch(() => false);
        if (!fileExists) {
            throw new Error(`GPG key file not found at ${sourcePath}`);
        }

        await AptlyUtils.ensureDirExists(path.dirname(outputPath));

        const buffer = await fs.readFile(sourcePath);
        const header = buffer.subarray(0, 64).toString("utf8");
        const isArmored = header.includes("BEGIN PGP");

        if (!isArmored) {
            if (sourcePath !== outputPath) {
                await fs.copyFile(sourcePath, outputPath);
            }
            return outputPath;
        }

        const dearmorProcess = Bun.spawn({
            cmd: ["gpg", "--dearmor", "--yes", "--output", outputPath, sourcePath],
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
        });

        const exitCode = await dearmorProcess.exited;
        if (exitCode !== 0) {
            const stderrText = dearmorProcess.stderr ? await new Response(dearmorProcess.stderr).text() : "";
            throw new Error(`Failed to dearmor GPG key at ${sourcePath}: ${stderrText}`);
        }

        Logger.info(`GPG key at ${sourcePath} dearmored to ${outputPath}`);
        return outputPath;
    }

    export async function ensureSigningConfigExists() {
        await AptlyUtils.ensureDirExists(AptlyAPIServer.dearmoredKeysDir);

        await ensureBinaryGpgKeyring(
            AptlyAPIServer.settings.keySettings.publicKeyPath,
            path.join(AptlyAPIServer.dearmoredKeysDir, "public-key.dearmored.gpg")
        );
        await ensureBinaryGpgKeyring(
            AptlyAPIServer.settings.keySettings.privateKeyPath,
            path.join(AptlyAPIServer.dearmoredKeysDir, "private-key.dearmored.gpg")
        );
    }
}