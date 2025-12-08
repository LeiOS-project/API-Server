import { client } from './api-client/client.gen';
import * as apiClient from "./api-client"
import { Logger } from '../utils/logger';
import { Utils } from '../utils';
import { AptlyUtils } from './utils';

export interface AptlyAPISettings {
    aptlyRoot: string;
    aptlyPort: number;
    s3Settings: {
        endpoint: string;
        region: string;
        bucket: string;
        prefix?: string;
        accessKeyId?: string;
        secretAccessKey?: string;
    };
}

export class AptlyAPIServer {

    private static isInitialized: boolean = false;

    public static aptlyProcess: Bun.Subprocess<"ignore", "pipe", "pipe">;

    public static settings: AptlyAPISettings;

    static get aptlyDataDir() {
        return this.settings.aptlyRoot + "/data";
    }
    static get aptlyUploadDir() {
        return this.aptlyDataDir + "/upload";
    }
    static get aptlyBinaryPath() {
        return this.settings.aptlyRoot + "/bin/aptly";
    }
    static get aptlyConfigPath() {
        return this.settings.aptlyRoot + "/.config/aptly.conf";
    }

    // public static aptlyRoot: string;
    // public static aptlyDataDir: string;
    // public static aptlyUploadDir: string;
    // public static aptlyBinaryPath: string;
    // public static aptlyConfigPath: string;
    // public static aptlyPort: number;

    static async init(settings: AptlyAPISettings) {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.settings = settings;

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
                "-listen=127.0.0.1:" + this.settings.aptlyPort.toString()
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
            baseUrl: `http://127.0.0.1:${this.settings.aptlyPort}`
        });

        await AptlyUtils.createDefaultRepositoriesIfNeeded();
        await AptlyUtils.initialRepoPublishIfNeeded();
    }

    protected static async setupAptlyConfig(overrideConfig: Record<string, any> = {}) {

        try {

            const config = {
                "rootDir": this.aptlyDataDir,
                "logLevel": Logger.getLogLevel(),
                // "EnableSwaggerEndpoint": true,
                "S3PublishEndpoints": {
                    "leios-live-repo": {
                        "region": this.settings.s3Settings.region,
                        "awsAccessKeyID": this.settings.s3Settings.accessKeyId,
                        "awsSecretAccessKey": this.settings.s3Settings.secretAccessKey,
                        "endpoint": this.settings.s3Settings.endpoint,
                        "bucket": this.settings.s3Settings.bucket,
                        "prefix": this.settings.s3Settings.prefix || "",
                    }
                },
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
