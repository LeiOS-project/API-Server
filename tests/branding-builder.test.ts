import { describe, expect, test } from "bun:test";
import path from "path";
import { BrandingBuilder } from "../src/utils/branding-builder";
import { ConfigHandler } from "../src/utils/config";

describe("BrandingBuilder", () => {

    test("getRepoPath resolves to configured branding repo", () => {
        const repoPath = BrandingBuilder.getRepoPath();
        expect(repoPath).toEndWith("branding-meta-files");
    });

    test("getRepoPath respects LRA_BRANDING_META_REPO override", () => {
        const original = ConfigHandler.getConfig()?.LRA_BRANDING_META_REPO;

        // Reset the cached config so loadConfig re-parses the environment.
        (ConfigHandler as any).config = null;
        process.env.LRA_BRANDING_META_REPO = "/tmp/override-branding";
        ConfigHandler.loadConfig();

        expect(BrandingBuilder.getRepoPath()).toBe("/tmp/override-branding");

        (ConfigHandler as any).config = null;
        if (original) {
            process.env.LRA_BRANDING_META_REPO = original;
        } else {
            delete process.env.LRA_BRANDING_META_REPO;
        }
        ConfigHandler.loadConfig();
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

});
