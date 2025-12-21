import { describe, expect, test } from "bun:test";
import { PackageModel } from "../src/api/utils/shared-models/package";

describe("Packge Schema Testing", () => {

    test("Forbidden Package Names should be correct", async () => {
        
        expect(PackageModel.CreatePackage.Body.safeParse({
            name: "admin",
            description: "A forbidden package",
            homepage_url: "https://example.com",
            requires_patching: false
        } satisfies PackageModel.CreatePackage.Body)).toEqual({success: false, error: expect.anything()});

        expect(PackageModel.CreatePackage.Body.safeParse({
            name: "valid-package-name",
            description: "A valid package",
            homepage_url: "https://example.com",
            requires_patching: false
        } satisfies PackageModel.CreatePackage.Body)).toEqual({success: true, data: expect.anything()});
        
        const invalidNames = [
            "AInvalidName", // Uppercase letters
            "i", // Too short
            "this-name-is-way-too-long-to-be-a-valid-package-name-because-it-exceeds-the-maximum-length", // Too long
            "invalid_name!", // Invalid character
            "-invalidstart", // Starts with invalid character
            "invalidend-", // Ends with invalid character
        ];

        for (const name of invalidNames) {
            console.log(`Testing invalid package name: ${name}`);
            expect(PackageModel.CreatePackage.Body.safeParse({
                name: name,
                description: "An invalid package",
                homepage_url: "https://example.com",
                requires_patching: false
            } satisfies PackageModel.CreatePackage.Body)).toEqual({success: false, error: expect.anything()});
        }

        const validNames = [
            "valid-name",
            "valid.name",
            "valid+name",
            "v1.0.0",
            "a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z7",
        ];

        for (const name of validNames) {
            expect(PackageModel.CreatePackage.Body.safeParse({
                name: name,
                description: "A valid package",
                homepage_url: "https://example.com",
                requires_patching: false
            } satisfies PackageModel.CreatePackage.Body)).toEqual({success: true, data: expect.anything()});
        }

    });
});

