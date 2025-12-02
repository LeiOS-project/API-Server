import { client } from './api-client/client.gen';
import * as apiClient from "./api-client"
import fs from 'fs/promises';
import path from 'path';
import { Logger } from '../utils/logger';
import { Utils } from '../utils';

export interface AptlyAPISettings {
    aptlyRoot: string;
    aptlyPort: number;
}

export class AptlyAPI {

    private static isInitialized: boolean = false;

    public static aptlyProcess: Bun.Subprocess<"ignore", "pipe", "pipe">;

    protected static aptlyRoot: string;
    protected static aptlyDataDir: string;
    protected static aptlyBinaryPath: string;
    protected static aptlyConfigPath: string;
    protected static aptlyPort: number;

    static async init(settings: AptlyAPISettings) {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.aptlyRoot = settings.aptlyRoot;
        this.aptlyDataDir = settings.aptlyRoot + "/data";
        this.aptlyBinaryPath = settings.aptlyRoot + "/bin/aptly";
        this.aptlyConfigPath = settings.aptlyRoot + "/.config/aptly.conf";
        this.aptlyPort = settings.aptlyPort;

        await this.downloadAptlyBinaryIfNeeded();

        await Utils.sleep(100);

        await this.setupAptlyConfig();

        await Utils.sleep(100);
    }

    static async start() {
        // Start Aptly in the background piping sdtout and stderr to Bun
        this.aptlyProcess = Bun.spawn({
            cmd: [
                this.aptlyBinaryPath,
                "-config=" + this.aptlyConfigPath,
                "api", "serve",
                "-listen=127.0.0.1:" + this.aptlyPort.toString()
            ],
            stdin: 'ignore',
            stdout: 'pipe',
            // stdout: 'ignore',
            stderr: 'pipe',
            detached: false
        });

        this.forwardAptlyOutput(this.aptlyProcess.stdout, (line: string) => Logger.info(`[APTLY] ${line}`));
        this.forwardAptlyOutput(this.aptlyProcess.stderr, (line: string) => Logger.error(`[APTLY] ${line}`));


        // ensure subprocess dies with parent
        const killChild = (type: NodeJS.Signals) => this.aptlyProcess.kill(type);
        process.on("SIGINT", killChild);
        process.on("SIGTERM", killChild);
        process.on("exit", killChild);


        await Utils.sleep(1000);

        if (this.aptlyProcess.exitCode !== null) {
            throw new Error("Failed to start Aptly API server. Exit code: " + this.aptlyProcess.exitCode);
        }

        client.setConfig({
            baseUrl: `http://127.0.0.1:${this.aptlyPort}`
        });

        await this.createDefaultRepositoriesIfNeeded();
    }

    protected static async downloadAptlyBinaryIfNeeded() {
        try {

            const fileExists = await fs.access(this.aptlyBinaryPath).then(() => true).catch(() => false);
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
            await fs.mkdir(path.dirname(this.aptlyBinaryPath), { recursive: true });

            const response = await Bun.fetch(asset.browser_download_url);

            const binName = asset.name.replace('.zip', '');

            if (!response.ok) {
                throw new Error("Failed to download Aptly binary.");
            }

            const file = Bun.file(`/tmp/aptly-download.zip`);
            await file.write(response);

            await Bun.$`unzip -o /tmp/aptly-download.zip -d /tmp/aptly-archive`.text();

            await fs.copyFile(`/tmp/aptly-archive/${binName}/aptly`, this.aptlyBinaryPath);
            await fs.chmod(this.aptlyBinaryPath, 0o755);

            await fs.rm(`/tmp/aptly-archive`, { recursive: true });
            await fs.rm(`/tmp/aptly-download.zip`, { recursive: true });

            Logger.info(`Aptly binary downloaded to ${this.aptlyBinaryPath}`);

        } catch (error) {
            throw new Error("Failed to fetch latest Aptly release: " + error);
        }
    }

    protected static async setupAptlyConfig(overrideConfig: Record<string, any> = {}) {

        try {

            const config = {
                "rootDir": this.aptlyDataDir,
                "logLevel": Logger.getLogLevel(),
                "S3PublishEndpoints": null,
                "FileSystemPublishEndpoints": null,
                "SwiftPublishEndpoints": null,
                "AzurePublishEndpoints": null,
                "packagePoolStorage": {}
            };

            await Bun.file(this.aptlyConfigPath).write(JSON.stringify({
                ...config,
                ...overrideConfig
            }));

            Logger.info(`Aptly config successfully setup`);
        } catch (error) {
            throw new Error("Failed to write Aptly config: " + error);
        }

    }

    protected static async createDefaultRepositoriesIfNeeded() {

        try {

            const existReposResponse = (await this.getClient().getApiRepos({}));

            if (!existReposResponse.data) {
                throw new Error("Failed to fetch existing repositories: " + existReposResponse.error);
            }
            const existingRepos = existReposResponse.data;

            if (!existingRepos.some(repo => repo.name === "leios-stable")) {
                await this.getClient().postApiRepos({
                    body: {
                        Name: "leios-stable",
                        DefaultComponent: "main",
                        DefaultDistribution: "stable"
                    }
                });
            }

            if (!existingRepos.some(repo => repo.name === "leios-testing")) {
                await this.getClient().postApiRepos({
                    body: {
                        Name: "leios-testing",
                        DefaultComponent: "main",
                        DefaultDistribution: "testing"
                    }
                });
            }

        } catch (error) {
            Logger.error("Failed to create default repositories: ", error);
            throw new Error("Failed to create default repositories: " + error);
        }

    }

    static getClient() {
        if (!this.isInitialized) {
            throw new Error("AptlyAPI not initialized. Call AptlyAPI.init before accessing the client.");
        }
        return apiClient;
    }

    private static forwardAptlyOutput(stream: ReadableStream<Uint8Array> | null, logFn: (message: string) => void) {
        if (!stream) return;

        const decoder = new TextDecoder();
        const reader = stream.getReader();
        let buffer = "";

        const emitLine = (rawLine: string) => {
            const line = rawLine.replace(/\r$/, "");
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

}
