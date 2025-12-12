import { describe, expect, test } from "bun:test";
import { StablePromotionRequestsModel } from "../src/api/utils/shared-models/stableRequests";
import { AdminStablePromotionRequestModel } from "../src/api/routes/admin/stable-promotion-requests/model";

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
		expect(() => AdminStablePromotionRequestModel.Decide.Body.parse({
			version: "1.2.3",
			arch: "x86" as any
		})).toThrow();
	});

});
