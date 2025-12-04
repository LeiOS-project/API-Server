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
        };

        const uploadResult = await AptlyAPI.Packages.uploadAndVerify("leios-testing", packageData, fileData);
        expect(uploadResult).toBe(true);

    });

    test("Get Package References", async () => {
        const packageRefs = await AptlyAPI.Packages.getRefInRepo("leios-testing", "fastfetch");
        expect(packageRefs[0]).toInclude("fastfetch");
    });

    test("Remove Package from Repo", async () => {
        const removeResult = await AptlyAPI.Packages.deleteInRepo("leios-testing", "fastfetch");
        expect(removeResult).toBe(true);

        const packageRefsAfterRemoval = await AptlyAPI.Packages.getRefInRepo("leios-testing", "fastfetch");
        expect(packageRefsAfterRemoval.length).toBe(0);
    });

});