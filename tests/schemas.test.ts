import { describe, expect, test } from "bun:test";
import { PackageModel } from "../src/api/utils/shared-models/package";
import { UserDataPolicys } from "../src/api/utils/shared-models/accountData";

describe("Package Schema Testing", () => {

    test("Package name validation matches the new short-name rules", async () => {

        expect(PackageModel.CreatePackage.Body.safeParse({
            name: "valid-package-name",
            publisher_id: 1,
            display_name: "Valid",
            description: "A valid package",
            homepage_url: "https://example.com",
            requires_patching: false
        } satisfies PackageModel.CreatePackage.Body)).toEqual({ success: true, data: expect.anything() });

        const invalidNames = [
            "AInvalidName",    // Uppercase letters
            "i",               // Too short (< 2)
            "a".repeat(201),   // Too long (> 200)
            "invalid_name!",   // Invalid characters
            "-invalidstart",   // Starts with hyphen
            "invalidend-",     // Ends with hyphen
            "valid+name",      // `+` is no longer allowed
        ];

        for (const name of invalidNames) {
            expect(PackageModel.CreatePackage.Body.safeParse({
                name,
                publisher_id: 1,
                display_name: "Invalid",
                description: "An invalid package",
                homepage_url: "https://example.com",
                requires_patching: false
            } satisfies PackageModel.CreatePackage.Body)).toEqual({ success: false, error: expect.anything() });
        }

        const validNames = [
            "admin",       // package short names are scoped to a publisher — "admin" is fine
            "valid-name",
            "valid.name",
            "v1.0.0",
            "a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z7",
        ];

        for (const name of validNames) {
            expect(PackageModel.CreatePackage.Body.safeParse({
                name,
                publisher_id: 1,
                display_name: "Valid",
                description: "A valid package",
                homepage_url: "https://example.com",
                requires_patching: false
            } satisfies PackageModel.CreatePackage.Body)).toEqual({ success: true, data: expect.anything() });
        }

    });
});


describe("User Account Policy Schema Testing", () => {

    test("Username validation", async () => {
        
        const invalidUsernames = [
            "aa", // Too short
            "thisusernameiswaytoolongtobevalidbecauseitexceedsthemaximumlength", // Too long
            "invalid_username!", // Invalid character !
            "-invalidstart", // Starts with invalid character
            "invalidend-", // Ends with invalid character
            "a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1x", // Too long (41 characters)
        ];

        for (const username of invalidUsernames) {
            expect(UserDataPolicys.Username.safeParse(username)).toEqual({ success: false, error: expect.anything() });
        }

        const validUsernames = [
            "valid-username",
            "valid.username",
            "valid_username",
            "validusername123_",
            "12345",
            "a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1",
        ];

        for (const username of validUsernames) {
            // console.log(`Testing valid username: ${username}`);
            expect(UserDataPolicys.Username.safeParse(username)).toEqual({ success: true, data: expect.anything() });
        }

    });

    test("Password validation", async () => {
        
        const invalidPasswords = [
            "short", // Too short
            "alllowercase1!", // No uppercase letter
            "ALLUPPERCASE1!", // No lowercase letter
            "NoNumbers!", // No number
            "NoSpecialChar1", // No special character
            "ThisPasswordIsWayTooLongToBeConsideredValidBecauseItExceedsTheMaximumAllowedLength123!@#", // Too long
        ];

        for (const password of invalidPasswords) {
            expect(UserDataPolicys.Password.safeParse(password)).toEqual({ success: false, error: expect.anything() });
        }

        const validPasswords = [
            "ValidPass1!",
            "Another$Good2",
            "Str0ng&P@ssword",
            "Complex#1234",
            "A1b2C3d4!",
        ];

        for (const password of validPasswords) {
            expect(UserDataPolicys.Password.safeParse(password)).toEqual({ success: true, data: expect.anything() });
        }

    });
    
});
