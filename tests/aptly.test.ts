import { describe, expect, test } from "bun:test";
import { AptlyAPI } from "../src/aptly/api";
import { uploadFixtureToArchive } from "./helpers/aptlyTestUtils";

describe("Aptly Package Tests", () => {

    test("Upload and Verify Package", async () => {

        const uploadResult = await AptlyAPI.Packages.uploadAndVerify(
            "leios-archive",
            {
                name: "fastfetch",
                maintainer_name: "Carter Li",
                maintainer_email: "zhangsongcui@live.cn",
                version: "2.55.0",
                architecture: "amd64"
            },
            new File([await Bun.file("./testdata/fastfetch_2.55.0_amd64.deb").arrayBuffer()], "package.deb")
        );
        expect(uploadResult).toBe(true);

    });

    test("Copy Package into Testing", async () => {
        await uploadFixtureToArchive();

        const copyResult = await AptlyAPI.Packages.copyIntoRepo("leios-testing", "fastfetch", "2.55.0", undefined, "amd64");
        expect(copyResult).toBe(true);

        const packageRefs = await AptlyAPI.Packages.getRefInRepo("leios-testing", "fastfetch");
        expect(packageRefs[0]).toInclude("fastfetch");
    });

    test("Get Package References", async () => {
        await uploadFixtureToArchive();

        const packageRefs = await AptlyAPI.Packages.getRefInRepo("leios-archive", "fastfetch");
        expect(packageRefs[0]).toInclude("fastfetch");
    });

    test("Check Package Existence", async () => {
        await uploadFixtureToArchive();

        const exists = await AptlyAPI.Packages.existsInRepo("leios-archive", "fastfetch", "2.55.0", undefined, "amd64");
        expect(exists).toBe(true);
    });

    test("Get Package Details", async () => {
        await uploadFixtureToArchive();

        const result = (await AptlyAPI.Packages.getInRepo("leios-archive", "fastfetch", "2.55.0", undefined, "amd64"))[0];
        expect(result).toBeDefined();
        expect(result.name).toBe("fastfetch");
        expect(result.version).toBe("2.55.0");
        expect(result.leios_patch).toBeUndefined();
        expect(result.architecture).toBe("amd64");
        expect(result.maintainer).toBe("Carter Li <zhangsongcui@live.cn>");
    });

    test("Remove Package from Repo", async () => {
        await uploadFixtureToArchive();

        const removeResult = await AptlyAPI.Packages.deleteInRepo("leios-archive", "fastfetch");
        expect(removeResult).toBe(true);

        const packageRefsAfterRemoval = await AptlyAPI.Packages.getRefInRepo("leios-archive", "fastfetch");
        expect(packageRefsAfterRemoval.length).toBe(0);
    });

    test("Delete Package from all Repos", async () => {
        await uploadFixtureToArchive();

        const deleteResult = await AptlyAPI.Packages.deleteAllInAllRepos("fastfetch");
        expect(deleteResult).toBe(true);

        const packageRefsAfterDeletion = await AptlyAPI.Packages.getRefInRepo("leios-testing", "fastfetch");
        expect(packageRefsAfterDeletion.length).toBe(0);
    });

});