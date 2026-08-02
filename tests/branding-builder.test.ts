import { describe, expect, test } from "bun:test";
import fs from "fs/promises";
import path from "path";
import { BrandingBuilder } from "../src/utils/branding-builder";

describe("BrandingBuilder", () => {

    test("getRepoPath resolves to managed repo path", () => {
        BrandingBuilder["managedRepoPath"] = "./data/branding-meta-files/repo";
        const repoPath = BrandingBuilder.getRepoPath();
        expect(repoPath).toEndWith("branding-meta-files");
    });

    test("buildBrandingPackage produces a .deb for stable distribution", async () => {
        const version = `2026.01.${String(Date.now()).slice(-3).padStart(3, "0")}`;
        const debPath = await BrandingBuilder.buildBrandingPackage({
            version,
            distribution: "stable",
            changelogLines: ["added feature A", "fixed issue B"]
        });

        expect(debPath).toEndWith(".deb");
        expect(debPath).toInclude(version);
        expect(await Bun.file(debPath).exists()).toBe(true);

        const info = await BrandingBuilder.extractPackageInfo(debPath);
        expect(info.package).toBe("leios.system.branding-meta-files");
        expect(info.version).toBe(version);
        expect(info.architecture).toBe("all");
        expect(info.maintainer).toBe("LeiOS Project Team <support@leios.dev>");
    }, 30000);

    test("buildBrandingPackage produces a .deb for testing distribution", async () => {
        const version = `2026.02.${String(Date.now()).slice(-3).padStart(3, "0")}`;
        const debPath = await BrandingBuilder.buildBrandingPackage({
            version,
            distribution: "testing"
        });

        expect(debPath).toEndWith(".deb");
        expect(debPath).toInclude(version);
        expect(await Bun.file(debPath).exists()).toBe(true);

        const info = await BrandingBuilder.extractPackageInfo(debPath);
        expect(info.package).toBe("leios.system.branding-meta-files");
        expect(info.version).toBe(version);
        expect(info.architecture).toBe("all");
    }, 30000);

    test("extractPackageInfo reads metadata from test fixture .deb", async () => {
        const info = await BrandingBuilder.extractPackageInfo("./testdata/base-files.deb");

        expect(info.package).toBe("leios.system.base-files");
        expect(info.version).toBe("100.1");
        expect(info.architecture).toBe("all");
        expect(info.maintainer).toBe("LeiOS Project Team <support@leios.dev>");
    });

    test("extractPackageInfo throws on missing required metadata", async () => {
        await expect(BrandingBuilder.extractPackageInfo("./testdata/old_schema.ts")).rejects.toThrow();
    });

    test("ensureRepo clones from hardcoded GitLab URL when no local repo exists", async () => {
        const dataDir = await fs.mkdtemp(path.join(process.cwd(), "tmp-branding-clone-"));

        const previousManaged = (BrandingBuilder as any).managedRepoPath;
        const previousUrl = (BrandingBuilder as any).GITLAB_REPO_URL;
        (BrandingBuilder as any).managedRepoPath = null;

        // Use an invalid URL so the clone fails deterministically without network.
        (BrandingBuilder as any).GITLAB_REPO_URL = "https://invalid-host.example.com/nonexistent-repo.git";

        try {
            await expect(BrandingBuilder.ensureRepo(dataDir)).rejects.toThrow("Failed to clone branding meta files repository");
        } finally {
            (BrandingBuilder as any).GITLAB_REPO_URL = previousUrl;
            (BrandingBuilder as any).managedRepoPath = previousManaged;
            await fs.rm(dataDir, { recursive: true, force: true });
        }
    }, 30000);

});
