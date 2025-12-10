import { describe, expect, test } from "bun:test";
import { AptlyUtils } from "../src/aptly/utils";
import { PackageReleaseModel } from "../src/api/utils/shared-models/pkg-releases";

describe("Testing Aptly Utilities", () => {

    test("Extract Version and Patch Suffix", () => {

        expect(AptlyUtils.extractVersionAndPatchSuffix("1.2.3leios1")).toEqual({
            version: "1.2.3",
            leios_patch: "1"
        });

        expect(AptlyUtils.extractVersionAndPatchSuffix("4.5.6")).toEqual({
            version: "4.5.6",
            leios_patch: undefined
        });

        expect(AptlyUtils.extractVersionAndPatchSuffix("7.8.9leios10")).toEqual({
            version: "7.8.9",
            leios_patch: "10"
        });

        expect(AptlyUtils.extractVersionAndPatchSuffix("0.1.2leios")).toEqual({
            version: "0.1.2leios",
            leios_patch: undefined
        });

        expect(AptlyUtils.extractVersionAndPatchSuffix("3.4.5leios0")).toEqual({
            version: "3.4.5",
            leios_patch: "0"
        });

        expect(AptlyUtils.extractVersionAndPatchSuffix("10.11.12leios9.9.9")).toEqual({
            version: "10.11.12",
            leios_patch: "9.9.9"
        });

        expect(AptlyUtils.extractVersionAndPatchSuffix("2.0.0leios1.2.3")).toEqual({
            version: "2.0.0",
            leios_patch: "1.2.3"
        });

    });

    test("test regex Version with leios Patch Suffix", () => {

        expect("1.2.3leios1").toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("4.5.6").toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("7.8leios10").toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("3.4.5leios0").toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("10.11.12leios9.9.9").toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("10.11.12-6leios9.9.9").toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("10.11.12-6").toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("1.2.3-1leios1").toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("1.2.3+build.leios1").toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("1.2.3~rc1leios1").toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("1.2.3~rc1+beta-2").toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("1.2.3~rc1+beta-2leios1.1").toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("1.2.3~rc1+beta-2leios1.1.1").toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("1.1.1~beta-1").toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("1.2.3leio").toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);

        expect("leios1.2.3").not.toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        // version of path is missing
        expect("0.1.2leios").not.toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("1.2.3leios").not.toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("1.2.3leios-1").not.toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("version1.2.3leios1").not.toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("1.2.3leios1patch").not.toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        // patch can only have up to three dots in between
        expect("1.2.3leios1.1.1.1").not.toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("1.2.3~rc1+beta-2leios1.1.1.1").not.toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("a1.2.3leios1").not.toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);
        expect("1.2.3leios1.1+beta").not.toMatch(PackageReleaseModel.versionWithLeiosPatchRegex);

    });

});