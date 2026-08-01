import fs from "fs/promises";
import path from "path";
import { Logger } from "./logger";
import { ConfigHandler } from "./config";

export interface BuildBrandingPackageOptions {
    version: string;
    distribution: "stable" | "testing";
    changelogLines?: string[];
}

export class BrandingBuilder {

    /**
     * Resolves the path to the leios.system.branding-meta-files repository.
     * It first checks the optional environment variable `LRA_BRANDING_META_REPO`,
     * then falls back to a sibling location next to the API-Server checkout.
     */
    static getRepoPath(): string {
        const envPath = ConfigHandler.getConfig()?.LRA_BRANDING_META_REPO;
        if (envPath) return envPath;

        // Default: ../../System-Packages/branding-meta-files relative to this file
        // (src/utils/branding-builder.ts -> project root -> sibling System-Packages)
        return path.resolve(import.meta.dir, "../../..", "System-Packages", "branding-meta-files");
    }

    /**
     * Builds the leios.system.branding-meta-files Debian package for the given
     * version and distribution.
     *
     * @returns The absolute path to the generated .deb file.
     */
    static async buildBrandingPackage(options: BuildBrandingPackageOptions): Promise<string> {
        const repoPath = this.getRepoPath();
        const buildScript = path.join(repoPath, "scripts", "build.sh");

        const repoExists = await fs.access(repoPath).then(() => true).catch(() => false);
        if (!repoExists) {
            throw new Error(`Branding meta files repository not found at ${repoPath}. Set LRA_BRANDING_META_REPO if it lives elsewhere.`);
        }

        const scriptExists = await fs.access(buildScript).then(() => true).catch(() => false);
        if (!scriptExists) {
            throw new Error(`Branding build script not found at ${buildScript}`);
        }

        const changelogArg = options.changelogLines
            ? options.changelogLines.map(line => line.replace(/"/g, '\\"')).join("\\n")
            : "";

        Logger.info(`Building leios.system.branding-meta-files package: version=${options.version}, dist=${options.distribution}`);

        const result = await Bun.$`bash ${buildScript} ${options.distribution} ${options.version} ${changelogArg}`
            .cwd(repoPath)
            .nothrow();

        if (result.exitCode !== 0) {
            const stderr = await new Response(result.stderr).text();
            throw new Error(`Failed to build branding meta files package: ${stderr}`);
        }

        // The build script writes artifacts to ./deb-build/
        const buildDir = path.join(repoPath, "deb-build");
        const entries = await fs.readdir(buildDir).catch(() => [] as string[]);
        const debFile = entries.find(entry => entry.endsWith(".deb") && entry.includes(options.version));

        if (!debFile) {
            throw new Error(`No .deb file found in ${buildDir} for version ${options.version}`);
        }

        const debPath = path.join(buildDir, debFile);
        Logger.info(`Built branding meta files package: ${debPath}`);
        return debPath;
    }

    /**
     * Extracts package metadata from a local .deb file using dpkg-deb.
     */
    static async extractPackageInfo(debPath: string): Promise<{
        package: string;
        version: string;
        architecture: string;
        maintainer: string;
    }> {
        const controlText = await Bun.$`dpkg-deb -f ${debPath}`.text();

        const parseField = (name: string): string => {
            const match = controlText.match(new RegExp(`^${name}: (.*)$`, "m"));
            return match?.[1]?.trim() || "";
        };

        const info = {
            package: parseField("Package"),
            version: parseField("Version"),
            architecture: parseField("Architecture"),
            maintainer: parseField("Maintainer"),
        };

        if (!info.package || !info.version || !info.architecture) {
            throw new Error(`Could not extract required metadata from ${debPath}`);
        }

        return info;
    }

}
