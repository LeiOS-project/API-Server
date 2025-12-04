import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { AptlyAPIServer } from "../src/aptly/server";
import { AptlyAPI } from "../src/aptly/api";

beforeAll(async() => {
    await AptlyAPIServer.init({
        aptlyRoot: "./data/aptly",
        aptlyPort: 8080
    });
    await AptlyAPIServer.start();
});

afterAll(() => {
    AptlyAPIServer.aptlyProcess.kill("SIGINT");
});

describe("Aptly Package Tests", () => {

    test("Upload and Verify Package", async () => {

        const filePath = "./testdata/fastfetch_2.55.0_amd64.deb";
        const fileData = new File([await Bun.file(filePath).arrayBuffer()], "package.deb");

        const packageData = {
            name: "fastfetch",
            maintainerName: "Carter Li",
            maintainerEmail: "zhangsongcui@live.cn",
            version: "2.55.0",
            architecture: "amd64"
        } as const;

        const uploadResult = await AptlyAPI.Packages.uploadAndVerify("leios-archive", packageData, fileData);
        expect(uploadResult).toBe(true);

    });

    test("Copy Package into Testing", async () => {
        const copyResult = await AptlyAPI.Packages.copyIntoRepo("leios-testing", "fastfetch", "2.55.0", undefined, "amd64");
        expect(copyResult).toBe(true);

        const packageRefs = await AptlyAPI.Packages.getRefInRepo("leios-testing", "fastfetch");
        expect(packageRefs[0]).toInclude("fastfetch");
    });

    test("Get Package References", async () => {
        const packageRefs = await AptlyAPI.Packages.getRefInRepo("leios-archive", "fastfetch");
        expect(packageRefs[0]).toInclude("fastfetch");
    });

    test("Check Package Existence", async () => {
        const exists = await AptlyAPI.Packages.existsInRepo("leios-archive", "fastfetch", "2.55.0", undefined, "amd64");
        expect(exists).toBe(true);
    });

    test("Get Package Details", async () => {
        const result = (await AptlyAPI.Packages.getInRepo("leios-archive", "fastfetch", "2.55.0", undefined, "amd64"))[0];
        expect(result).toBeDefined();
        expect(result.name).toBe("fastfetch");
        expect(result.version).toBe("2.55.0");
        expect(result.leiosPatch).toBeUndefined();
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