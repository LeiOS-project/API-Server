import { describe, expect, test } from "bun:test";
import { AptlyAPI } from "../src/aptly/api";

describe("Aptly Package Tests for fastfetch arch: amd64", () => {

    test("Upload and Verify Package", async () => {

        const filePath = "./testdata/fastfetch_2.55.0_amd64.deb";
        const fileData = new File([await Bun.file(filePath).arrayBuffer()], "package.deb");

        const packageData = {
            fullname: "fastfetch.fastfetch",
            maintainer_name: "Carter Li",
            maintainer_email: "zhangsongcui@live.cn",
            versionWithLeiosPatch: "2.55.0",
            architecture: "amd64"
        } as const;

        const uploadResult = await AptlyAPI.Packages.uploadAndVerifyIntoArchiveRepo(packageData, fileData);
        expect(uploadResult).toBe(true);

    });

    test("Copy Package into Testing", async () => {
        const copyResult = await AptlyAPI.Packages.copyIntoRepo("leios-testing", "fastfetch.fastfetch", "2.55.0", "amd64");
        expect(copyResult).toBe(true);

        const packageRefs = await AptlyAPI.Packages.getRefInRepo("leios-testing", "fastfetch.fastfetch");
        expect(packageRefs[0]).toInclude("fastfetch.fastfetch");
    });

    test("Get Package References", async () => {
        const packageRefs = await AptlyAPI.Packages.getRefInRepo("leios-archive", "fastfetch.fastfetch");
        expect(packageRefs[0]).toInclude("fastfetch.fastfetch");
    });

    test("Check Package Existence", async () => {
        const exists = await AptlyAPI.Packages.existsInRepo("leios-archive", "fastfetch.fastfetch", "2.55.0", "amd64");
        expect(exists).toBe(true);
    });

    test("Get Package Details", async () => {
        
        const result = (await AptlyAPI.Packages.getInRepo("leios-archive", "fastfetch.fastfetch", "2.55.0", "amd64"))[0];

        expect(result).toBeDefined();
        if (!result) return;

        expect(result.name).toBe("fastfetch.fastfetch");
        expect(result.versionWithLeiosPatch).toBe("2.55.0");
        expect(result.architecture).toBe("amd64");
        expect(result.maintainer).toBe("Carter Li <zhangsongcui@live.cn>");
    });

    test("Remove Package from Repo", async () => {
        const removeResult = await AptlyAPI.Packages.deleteInRepo("leios-archive", "fastfetch.fastfetch");
        expect(removeResult).toBe(true);

        const packageRefsAfterRemoval = await AptlyAPI.Packages.getRefInRepo("leios-archive", "fastfetch.fastfetch");
        expect(packageRefsAfterRemoval.length).toBe(0);
    });

    test("Delete Package from all Repos", async () => {
        const deleteResult = await AptlyAPI.Packages.deleteAllInAllRepos("fastfetch.fastfetch");
        expect(deleteResult).toBe(true);

        const packageRefsAfterDeletion = await AptlyAPI.Packages.getRefInRepo("leios-testing", "fastfetch.fastfetch");
        expect(packageRefsAfterDeletion.length).toBe(0);
    });

});

describe("Aptly Package Tests for base-files arch: all", () => {

    test("Upload and Verify Package", async () => {

        const filePath = "./testdata/base-files.deb";
        const fileData = new File([await Bun.file(filePath).arrayBuffer()], "package.deb");

        const packageData = {
            fullname: "leios.system.base-files",
            maintainer_name: "LeiOS Project Team",
            maintainer_email: "support@leios.dev",
            versionWithLeiosPatch: "100.1",
            architecture: "all"
        } as const;

        const uploadResult = await AptlyAPI.Packages.uploadAndVerifyIntoArchiveRepo(packageData, fileData);
        expect(uploadResult).toBe(true);

    });

    test("Copy Package into Testing", async () => {
        const copyResult = await AptlyAPI.Packages.copyIntoRepo("leios-testing", "leios.system.base-files", "100.1", "all");
        expect(copyResult).toBe(true);

        const packageRefs = await AptlyAPI.Packages.getRefInRepo("leios-testing", "leios.system.base-files");
        expect(packageRefs[0]).toInclude("leios.system.base-files");
    });

    test("Get Package References", async () => {
        const packageRefs = await AptlyAPI.Packages.getRefInRepo("leios-archive", "leios.system.base-files");
        expect(packageRefs[0]).toInclude("leios.system.base-files");
    });

    test("Check Package Existence", async () => {
        const exists = await AptlyAPI.Packages.existsInRepo("leios-archive", "leios.system.base-files", "100.1", "all");
        expect(exists).toBe(true);
    });

    test("Get Package Details", async () => {
        
        const result = (await AptlyAPI.Packages.getInRepo("leios-archive", "leios.system.base-files", "100.1", "all"))[0];

        expect(result).toBeDefined();
        if (!result) return;

        expect(result.name).toBe("leios.system.base-files");
        expect(result.versionWithLeiosPatch).toBe("100.1");
        expect(result.architecture).toBe("all");
        expect(result.maintainer).toBe("LeiOS Project Team <support@leios.dev>");
    });

    test("Remove Package from Repo", async () => {
        const removeResult = await AptlyAPI.Packages.deleteInRepo("leios-archive", "leios.system.base-files");
        expect(removeResult).toBe(true);

        const packageRefsAfterRemoval = await AptlyAPI.Packages.getRefInRepo("leios-archive", "leios.system.base-files");
        expect(packageRefsAfterRemoval.length).toBe(0);
    });

    test("Delete Package from all Repos", async () => {
        const deleteResult = await AptlyAPI.Packages.deleteAllInAllRepos("leios.system.base-files");
        expect(deleteResult).toBe(true);

        const packageRefsAfterDeletion = await AptlyAPI.Packages.getRefInRepo("leios-testing", "leios.system.base-files");
        expect(packageRefsAfterDeletion.length).toBe(0);
    });

});

describe("Aptly Package Tests for local .deb upload", () => {

    test("Upload local .deb into archive repo", async () => {
        const filePath = "./testdata/base-files.deb";

        const result = await AptlyAPI.Packages.uploadLocalDebIntoArchiveRepo(filePath);

        expect(result.name).toBe("leios.system.base-files");
        expect(result.version).toBe("100.1");
        expect(result.architecture).toBe("all");

        const exists = await AptlyAPI.Packages.existsInRepo("leios-archive", "leios.system.base-files", "100.1", "all");
        expect(exists).toBe(true);
    });

    test("Upload local .deb is idempotent", async () => {
        const filePath = "./testdata/base-files.deb";

        const firstResult = await AptlyAPI.Packages.uploadLocalDebIntoArchiveRepo(filePath);
        const secondResult = await AptlyAPI.Packages.uploadLocalDebIntoArchiveRepo(filePath);

        expect(secondResult.name).toBe(firstResult.name);
        expect(secondResult.version).toBe(firstResult.version);
        expect(secondResult.architecture).toBe(firstResult.architecture);

        const refs = await AptlyAPI.Packages.getRefInRepo("leios-archive", "leios.system.base-files", "100.1", "all");
        expect(refs.length).toBe(1);
    });

    test("Delete locally uploaded package from all repos", async () => {
        const deleteResult = await AptlyAPI.Packages.deleteAllInAllRepos("leios.system.base-files");
        expect(deleteResult).toBe(true);

        const packageRefsAfterDeletion = await AptlyAPI.Packages.getRefInRepo("leios-testing", "leios.system.base-files");
        expect(packageRefsAfterDeletion.length).toBe(0);
    });

});