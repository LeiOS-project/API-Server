import { describe, expect, test } from "bun:test";
import { StablePromotionRequestsModel } from "../src/api/utils/shared-models/stableRequests";
import { AdminStablePromotionRequestModel } from "../src/api/versions/v1/routes/admin/stable-promotion-requests/model";

describe("StableRequestModel schemas", () => {
	test("accepts empty create payload", () => {
		const parsed = StablePromotionRequestsModel.Create.Body.parse({});

		expect(parsed).toEqual({});
	});

	test("rejects extra fields in create payload", () => {
		expect(() => StablePromotionRequestsModel.Create.Body.parse({ package_release_id: 42 } as any)).toThrow();
	});

	test("rejects invalid architecture for copy body", () => {
		expect(() => AdminStablePromotionRequestModel.Decide.Body.parse({
			version: "1.2.3",
			arch: "x86" as any
		})).toThrow();
	});

});
