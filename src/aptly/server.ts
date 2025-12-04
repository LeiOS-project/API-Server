import { client } from './api-client/client.gen';
import * as apiClient from "./api-client"
import { Logger } from '../utils/logger';
import { Utils } from '../utils';
import { AptlyUtils } from './utils';

export interface AptlyAPISettings {
    aptlyRoot: string;
    aptlyPort: number;
}

export class AptlyAPIServer {

    private static isInitialized: boolean = false;

    public static aptlyProcess: Bun.Subprocess<"ignore", "pipe", "pipe">;

    public static aptlyRoot: string;
    public static aptlyDataDir: string;
    public static aptlyUploadDir: string;
    public static aptlyBinaryPath: string;
    public static aptlyConfigPath: string;
    public static aptlyPort: number;

    static async init(settings: AptlyAPISettings) {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.aptlyRoot = settings.aptlyRoot;
        this.aptlyDataDir = settings.aptlyRoot + "/data";
        this.aptlyUploadDir = this.aptlyDataDir + "/upload";
        this.aptlyBinaryPath = settings.aptlyRoot + "/bin/aptly";
        this.aptlyConfigPath = settings.aptlyRoot + "/.config/aptly.conf";
        this.aptlyPort = settings.aptlyPort;

        await AptlyUtils.downloadAptlyBinaryIfNeeded(this.aptlyBinaryPath);

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

        AptlyUtils.forwardAptlyOutput(this.aptlyProcess.stdout, (line: string) => Logger.info(`[APTLY] ${line}`));
        AptlyUtils.forwardAptlyOutput(this.aptlyProcess.stderr, (line: string) => Logger.error(`[APTLY] ${line}`));


        await Utils.sleep(1000);

        if (this.aptlyProcess.exitCode !== null) {
            throw new Error("Failed to start Aptly API server. Exit code: " + this.aptlyProcess.exitCode);
        }

        client.setConfig({
            baseUrl: `http://127.0.0.1:${this.aptlyPort}`
        });

        await this.createDefaultRepositoriesIfNeeded();
    }

    protected static async setupAptlyConfig(overrideConfig: Record<string, any> = {}) {

        try {

            const config = {
                "rootDir": this.aptlyDataDir,
                "logLevel": Logger.getLogLevel(),
                // "EnableSwaggerEndpoint": true,
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

            if (!existingRepos.some(repo => repo.Name === "leios-stable")) {
                await this.getClient().postApiRepos({
                    body: {
                        Name: "leios-stable",
                        DefaultComponent: "main",
                        DefaultDistribution: "stable"
                    }
                });

                Logger.info("Repository 'leios-stable' created.");
            }

            if (!existingRepos.some(repo => repo.Name === "leios-testing")) {
                await this.getClient().postApiRepos({
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
                await this.getClient().postApiRepos({
                    body: {
                        Name: "leios-archive",
                        DefaultComponent: "main",
                        DefaultDistribution: "archive"
                    }
                });

                Logger.info("Repository 'leios-archive' created.");
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


    static async stop(type: NodeJS.Signals) {
        if (this.aptlyProcess) {
            this.aptlyProcess.kill(type);
            Logger.info("Aptly process stopped.");
        }
    }

}
