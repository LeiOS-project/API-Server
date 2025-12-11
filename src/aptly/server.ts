import fs from "fs/promises";
import path from "path";
import z from "zod";
import { client } from "./api-client/client.gen";
import * as apiClient from "./api-client";
import { Logger } from "../utils/logger";
import { AptlyUtils } from "./utils";

const AptlyAPISettingsSchema = z.object({
    aptlyRoot: z.string().min(1),
    aptlyPort: z.number().int().positive(),
    s3Settings: z.object({
        endpoint: z.string().min(1),
        region: z.string().min(1),
        bucket: z.string().min(1),
        prefix: z.string().optional(),
        accessKeyId: z.string().optional(),
        secretAccessKey: z.string().optional(),
    }),
    keySettings: z.object({
        publicKeyPath: z.string().min(1),
        privateKeyPath: z.string().min(1),
    }),
});
export type AptlyAPISettings = z.infer<typeof AptlyAPISettingsSchema>;

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

    static get dearmoredKeysDir() {
        return this.settings.aptlyRoot + "/.keys";
    }

    static get baseUrl() {
        return `http://127.0.0.1:${this.settings.aptlyPort}`;
    }

    static get SigningConfig() {
        return {
            Keyring: path.join(AptlyAPIServer.dearmoredKeysDir, "public-key.dearmored.gpg"),
            SecretKeyring: path.join(AptlyAPIServer.dearmoredKeysDir, "private-key.dearmored.gpg"),
        } as const;
    }

    private static async ensureDirectories() {
        await AptlyUtils.ensureDirExists(this.settings.aptlyRoot);
        await AptlyUtils.ensureDirExists(this.aptlyDataDir);
        await AptlyUtils.ensureDirExists(path.dirname(this.aptlyBinaryPath));
        await AptlyUtils.ensureDirExists(path.dirname(this.aptlyConfigPath));
        await AptlyUtils.ensureDirExists(this.aptlyUploadDir);
        await AptlyUtils.ensureDirExists(this.dearmoredKeysDir);
    }

    static async init(settings: AptlyAPISettings) {
        if (this.isInitialized) return;

        this.settings = AptlyAPISettingsSchema.parse(settings);

        await this.ensureDirectories();
        await AptlyUtils.downloadAptlyBinaryIfNeeded(this.aptlyBinaryPath);
        await AptlyUtils.Signing.ensureSigningConfigExists();
        await this.setupAptlyConfig();

        this.isInitialized = true;
    }

    static async start() {
        if (!this.isInitialized) {
            throw new Error("AptlyAPIServer not initialized. Call init before start.");
        }

        this.aptlyProcess = Bun.spawn({
            cmd: [
                this.aptlyBinaryPath,
                "-config=" + this.aptlyConfigPath,
                "api", "serve",
                "-listen=127.0.0.1:" + this.settings.aptlyPort.toString()
            ],
            env: {
                PATH: process.env.PATH
            },
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            detached: false
        });

        AptlyUtils.forwardAptlyOutput(this.aptlyProcess.stdout, (line: string) => Logger.info(`[APTLY] ${line}`));
        // Aptly sends DBG messages to stderr; route them to debug to avoid noisy errors
        AptlyUtils.forwardAptlyOutput(this.aptlyProcess.stderr, (line: string) => {
            if (line.includes("DBG")) {
                Logger.debug(`[APTLY] ${line}`);
            } else {
                Logger.error(`[APTLY] ${line}`);
            }
        });

        if (this.aptlyProcess.exitCode !== null) {
            throw new Error("Failed to start Aptly API server. Exit code: " + this.aptlyProcess.exitCode);
        }

        await AptlyUtils.waitForAptlyReady(this.baseUrl);

        client.setConfig({
            baseUrl: this.baseUrl
        });

        await AptlyUtils.createDefaultRepositoriesIfNeeded();
        await AptlyUtils.initialRepoPublishIfNeeded();
    }

    protected static async setupAptlyConfig(overrideConfig: Record<string, any> = {}) {

        try {

            const config = {
                "rootDir": this.aptlyDataDir,
                "logLevel": Logger.getLogLevel(),
                "gpgProvider": "internal",
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

            await AptlyUtils.ensureDirExists(path.dirname(this.aptlyConfigPath));

            await fs.writeFile(
                this.aptlyConfigPath,
                JSON.stringify({
                    ...config,
                    ...overrideConfig
                }),
                "utf8"
            );

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


    static async stop(type: NodeJS.Signals = "SIGTERM") {
        if (this.aptlyProcess) {
            this.aptlyProcess.kill(type);
            await this.aptlyProcess.exited.catch(() => null);
            Logger.info("Aptly process stopped.");
        }
    }

}
