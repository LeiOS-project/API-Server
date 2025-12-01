import { client } from './api-client/client.gen';
import * as apiClient from "./api-client"
import fs from 'fs/promises';
import path from 'path';

export interface AptlyAPISettings {
    aptlyBinaryPath: string;
    aptlyConfigPath: string;
    aptlyDataPath: string;
    aptlyPort: number;
}

export class AptlyAPI {

    private static isInitialized: boolean = false;

    static async init(settings: AptlyAPISettings) {
        this.isInitialized = true;

        await this.downloadAptlyBinaryIfNeeded(settings.aptlyBinaryPath);

        client.setConfig({
            baseUrl: `http://localhost:${settings.aptlyPort}`,
        });

        await this.createDefaultRepositoriesIfNeeded();
    }

    protected static async downloadAptlyBinaryIfNeeded(targetPath: string) {
        try {

            const fileExists = await fs.access(targetPath).then(() => true).catch(() => false);
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
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            
            const response = await Bun.fetch(asset.browser_download_url);

            if (!response.ok) {
                throw new Error("Failed to download Aptly binary.");
            }

            const buffer = await response.arrayBuffer();

            await Bun.write(targetPath, new Uint8Array(buffer), { mode: 0o755 });

        } catch (error) {
            console.error("Failed to fetch latest Aptly release: ", error);
            throw new Error("Failed to fetch latest Aptly release: " + error);
        }
    }

    protected static async createDefaultRepositoriesIfNeeded() {

        try {

            const existReposResponse = await this.getClient().getApiRepos({});

            const createStableRepoResponse = await this.getClient().postApiRepos({
                body: {
                    Name: "leios-stable",
                    DefaultComponent: "main",
                    DefaultDistribution: "stable"
                }
            })

            const createTestingRepoResponse = await this.getClient().postApiRepos({
                body: {
                    Name: "leios-testing",
                    DefaultComponent: "main",
                    DefaultDistribution: "testing"
                }
            });

        } catch (error) {
            throw new Error("Failed to create default repositories: " + error);
        }
        
    }

    static getClient() {
        if (!this.isInitialized) {
            throw new Error("AptlyAPI not initialized. Call AptlyAPI.init(apiUrl) before accessing the client.");
        }
        return apiClient;
    }

}
