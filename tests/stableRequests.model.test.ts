import { describe, expect, test } from "bun:test";
import { StablePromotionRequestsModel } from "../src/api/utils/shared-models/stableRequests";

describe("StableRequestModel schemas", () => {
	test("accepts valid create payload", () => {
		const parsed = StablePromotionRequestsModel.Create.Body.parse({
			package_release_id: 42,
		});

		expect(parsed.package_release_id).toBe(42);
	});

	test("rejects missing package_release_id", () => {
		expect(() => StablePromotionRequestsModel.Create.Body.parse({} as any)).toThrow();
	});

	test("rejects invalid architecture for copy body", () => {
		expect(() => StablePromotionRequestsModel.CopyToStable.Body.parse({
			version: "1.2.3",
			arch: "x86" as any
		})).toThrow();
	});

	test("accepts copy response shape", () => {
		const parsed = StablePromotionRequestsModel.CopyToStable.Response.parse({
			version: "2.0.0",
			arch: "arm64",
			copied: true
		});

		expect(parsed.copied).toBe(true);
		expect(parsed.arch).toBe("arm64");
	});
});
