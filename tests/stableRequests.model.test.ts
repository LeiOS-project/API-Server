// import { describe, expect, test } from "bun:test";
// import { StableRequestModel } from "../src/api/utils/shared-models/stableRequests";

// describe("StableRequestModel schemas", () => {

//     test("accepts valid create payload", () => {
//         const parsed = StableRequestModel.Create.Body.parse({
//             version: "1.2.3",
//             arch: "amd64"
//         });

//         expect(parsed.version).toBe("1.2.3");
//         expect(parsed.arch).toBe("amd64");
//     });

//     test("rejects invalid architecture", () => {
//         expect(() => StableRequestModel.Create.Body.parse({
//             version: "1.2.3",
//             // @ts-expect-error - invalid arch is rejected
//             arch: "x86"
//         })).toThrow();
//     });

//     test("accepts copy response shape", () => {
//         const parsed = StableRequestModel.CopyToStable.Response.parse({
//             version: "2.0.0",
//             arch: "arm64",
//             copied: true
//         });

//         expect(parsed.copied).toBe(true);
//         expect(parsed.arch).toBe("arm64");
//     });

// });
