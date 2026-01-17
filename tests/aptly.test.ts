import { describe, expect, test } from "bun:test";
import { AptlyAPI } from "../src/aptly/api";

describe("Aptly Package Tests for fastfetch arch: amd64", () => {

    test("Upload and Verify Package", async () => {

        const filePath = "./testdata/fastfetch_2.55.0_amd64.deb";
        const fileData = new File([await Bun.file(filePath).arrayBuffer()], "package.deb");

        const packageData = {
            name: "fastfetch",
            maintainer_name: "Carter Li",
            maintainer_email: "zhangsongcui@live.cn",
            versionWithLeiosPatch: "2.55.0",
            architecture: "amd64"
        } as const;

        const uploadResult = await AptlyAPI.Packages.uploadAndVerifyIntoArchiveRepo(packageData, fileData);
        expect(uploadResult).toBe(true);

    });

    test("Copy Package into Testing", async () => {
        const copyResult = await AptlyAPI.Packages.copyIntoRepo("leios-testing", "fastfetch", "2.55.0", "amd64");
        expect(copyResult).toBe(true);

        const packageRefs = await AptlyAPI.Packages.getRefInRepo("leios-testing", "fastfetch");
        expect(packageRefs[0]).toInclude("fastfetch");
    });

    test("Get Package References", async () => {
        const packageRefs = await AptlyAPI.Packages.getRefInRepo("leios-archive", "fastfetch");
        expect(packageRefs[0]).toInclude("fastfetch");
    });

    test("Check Package Existence", async () => {
        const exists = await AptlyAPI.Packages.existsInRepo("leios-archive", "fastfetch", "2.55.0", "amd64");
        expect(exists).toBe(true);
    });

    test("Get Package Details", async () => {
        
        const result = (await AptlyAPI.Packages.getInRepo("leios-archive", "fastfetch", "2.55.0", "amd64"))[0];

        expect(result).toBeDefined();
        if (!result) return;

        expect(result.name).toBe("fastfetch");
        expect(result.versionWithLeiosPatch).toBe("2.55.0");
        expect(result.architecture).toBe("amd64");
        expect(result.maintainer).toBe("Carter Li <zhangsongcui@live.cn>");
    });

    test("Remove Package from Repo", async () => {
        const removeResult = await AptlyAPI.Packages.deleteInRepo("leios-archive", "fastfetch");
        expect(removeResult).toBe(true);

        const packageRefsAfterRemoval = await AptlyAPI.Packages.getRefInRepo("leios-archive", "fastfetch");
        expect(packageRefsAfterRemoval.length).toBe(0);
    });

    test("Delete Package from all Repos", async () => {
        const deleteResult = await AptlyAPI.Packages.deleteAllInAllRepos("fastfetch");
        expect(deleteResult).toBe(true);

        const packageRefsAfterDeletion = await AptlyAPI.Packages.getRefInRepo("leios-testing", "fastfetch");
        expect(packageRefsAfterDeletion.length).toBe(0);
    });

});

describe("Aptly Package Tests for base-files arch: all", () => {

    test("Upload and Verify Package", async () => {

        const filePath = "./testdata/vanilla-os-base-files.deb";
        const fileData = new File([await Bun.file(filePath).arrayBuffer()], "package.deb");

        const packageData = {
            name: "base-files",
            maintainer_name: "Santiago Vila",
            maintainer_email: "sanvila@debian.org",
            versionWithLeiosPatch: "100.1",
            architecture: "all"
        } as const;

        const uploadResult = await AptlyAPI.Packages.uploadAndVerifyIntoArchiveRepo(packageData, fileData);
        expect(uploadResult).toBe(true);

    });

    test("Copy Package into Testing", async () => {
        const copyResult = await AptlyAPI.Packages.copyIntoRepo("leios-testing", "base-files", "100.1", "all");
        expect(copyResult).toBe(true);

        const packageRefs = await AptlyAPI.Packages.getRefInRepo("leios-testing", "base-files");
        expect(packageRefs[0]).toInclude("base-files");
    });

    test("Get Package References", async () => {
        const packageRefs = await AptlyAPI.Packages.getRefInRepo("leios-archive", "base-files");
        expect(packageRefs[0]).toInclude("base-files");
    });

    test("Check Package Existence", async () => {
        const exists = await AptlyAPI.Packages.existsInRepo("leios-archive", "base-files", "100.1", "all");
        expect(exists).toBe(true);
    });

    test("Get Package Details", async () => {
        
        const result = (await AptlyAPI.Packages.getInRepo("leios-archive", "base-files", "100.1", "all"))[0];

        expect(result).toBeDefined();
        if (!result) return;

        expect(result.name).toBe("base-files");
        expect(result.versionWithLeiosPatch).toBe("100.1");
        expect(result.architecture).toBe("all");
        expect(result.maintainer).toBe("Santiago Vila <sanvila@debian.org>");
    });

    test("Remove Package from Repo", async () => {
        const removeResult = await AptlyAPI.Packages.deleteInRepo("leios-archive", "base-files");
        expect(removeResult).toBe(true);

        const packageRefsAfterRemoval = await AptlyAPI.Packages.getRefInRepo("leios-archive", "base-files");
        expect(packageRefsAfterRemoval.length).toBe(0);
    });

    test("Delete Package from all Repos", async () => {
        const deleteResult = await AptlyAPI.Packages.deleteAllInAllRepos("base-files");
        expect(deleteResult).toBe(true);

        const packageRefsAfterDeletion = await AptlyAPI.Packages.getRefInRepo("leios-testing", "base-files");
        expect(packageRefsAfterDeletion.length).toBe(0);
    });

});