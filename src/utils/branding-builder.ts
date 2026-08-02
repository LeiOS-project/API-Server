import fs from "fs/promises";
import path from "path";
import { Logger } from "./logger";

export interface BuildBrandingPackageOptions {
    version: string;
    distribution: "stable" | "testing";
    changelogLines?: string[];
}

export class BrandingBuilder {

    private static readonly GITLAB_REPO_URL = "https://git.leicraftmc.de/LeiOS/System-Packages/Branding-Meta-Files";

    private static managedRepoPath: string | null = null;

    /**
     * Resolves the path to the leios.system.branding-meta-files repository.
     *
     * Returns the managed repo path once {@link ensureRepo} has been called.
     */
    static getRepoPath(): string {
        if (this.managedRepoPath) return this.managedRepoPath;

        // Default: ../../System-Packages/branding-meta-files relative to this file
        // (src/utils/branding-builder.ts -> project root -> sibling System-Packages)
        return path.resolve(import.meta.dir, "../../..", "System-Packages", "branding-meta-files");
    }

    /**
     * Ensures the branding meta files repository is available at the given data
     * directory location.
     *
     * The repository is cloned from the hardcoded GitLab URL into
     * `<dataDir>/branding-meta-files`. On subsequent calls, a `git pull` is
     * attempted to sync the latest changes, but failures are logged and ignored.
     *
     * @param dataDir - Root data directory where the cloned repo should live.
     */
    static async ensureRepo(dataDir: string): Promise<string> {
        const gitlabUrl = this.GITLAB_REPO_URL;
        const repoDir = path.resolve(dataDir, "repo");
        const exists = await fs.access(repoDir).then(() => true).catch(() => false);

        if (exists) {
            Logger.info(`Syncing branding meta files repository at ${repoDir}`);
            const pullResult = await Bun.$`git pull`.cwd(repoDir).nothrow().quiet();
            if (pullResult.exitCode !== 0) {
                const stderr = await new Response(pullResult.stderr).text();
                Logger.warn(`Git pull for branding meta files failed (continuing with existing copy): ${stderr.trim()}`);
            } else {
                Logger.info(`Branding meta files repository synced successfully.`);
            }
        } else {
            await fs.mkdir(dataDir, { recursive: true });
            Logger.info(`Cloning branding meta files repository from ${gitlabUrl} into ${repoDir}`);
            const cloneResult = await Bun.$`git clone ${gitlabUrl} ${repoDir}`.nothrow().quiet();
            if (cloneResult.exitCode !== 0) {
                const stderr = await new Response(cloneResult.stderr).text();
                throw new Error(`Failed to clone branding meta files repository: ${stderr.trim()}`);
            }
            Logger.info(`Branding meta files repository cloned successfully.`);
        }

        this.managedRepoPath = repoDir;
        return repoDir;
    }

    /**
     * Builds the leios.system.branding-meta-files Debian package for the given
     * version and distribution. Ensures the repository is available first.
     *
     * @returns The absolute path to the generated .deb file.
     */
    static async buildBrandingPackage(options: BuildBrandingPackageOptions): Promise<string> {
        const repoPath = this.getRepoPath();
        const buildScript = path.join(repoPath, "scripts", "build.sh");

        const repoExists = await fs.access(repoPath).then(() => true).catch(() => false);
        if (!repoExists) {
            throw new Error(`Branding meta files repository not found at ${repoPath}. Call ensureRepo() first.`);
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
