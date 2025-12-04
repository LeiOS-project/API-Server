import { Logger } from "../utils/logger";
import fs from 'fs/promises';
import path from 'path';
import z from "zod";

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

    static extractVersionAndPatchSuffix(fullVersion: string) {
        const leiosSuffixMatch = fullVersion.match(/(.*)leios(\d+)$/);
        if (leiosSuffixMatch) {
            return {
                version: leiosSuffixMatch[1],
                leiosPatch: parseInt(leiosSuffixMatch[2])
            };
        } else {
            return {
                version: fullVersion,
                leiosPatch: undefined
            };
        }
    }



    static buildVersionWithLeiOSSuffix(version: string, leiosPatch?: number) {
        if (leiosPatch) {
            if (version.endsWith(`leios${leiosPatch}`)) {
                return version;
            }
            return version + `leios${leiosPatch}`;
        }
        return version;
    }

    static getPackageIdentifier(packageName: string, fullPackageVersion: string, architecture: string): string;
    static getPackageIdentifier(packageName: string, packageVersion: string, leiosPatch: number | undefined, architecture: string): string;
    static getPackageIdentifier(packageName: string, versionOrFullVersion: string, leiosPatchOrArch: number | string | undefined, architectureOpt?: string) {

        let fullPackageVersion: string;

        if (typeof leiosPatchOrArch === "number" || leiosPatchOrArch === undefined) {
            // Called with (packageName, packageVersion, leiosPatch, architecture)
            fullPackageVersion = this.buildVersionWithLeiOSSuffix(versionOrFullVersion, leiosPatchOrArch as number | undefined);
        } else {
            // Called with (packageName, fullPackageVersion, architecture)
            fullPackageVersion = versionOrFullVersion;
        }

        const architecture = typeof leiosPatchOrArch === "string" ? leiosPatchOrArch : architectureOpt!;

        return `${packageName}_${fullPackageVersion}_${architecture}`;
    }

}
