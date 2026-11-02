import { describe, expect, test } from "bun:test";
import { AdminStablePromotionRequestModel } from "../src/api/versions/v1/routes/admin/stable-promotion-requests/model";
import { StablePromotionRequestsModel } from "../src/api/versions/v1/routes/packages/releases/stable-promotion-requests/model";

describe("StableRequestModel schemas", () => {
	test("accepts an empty create payload and an optional message", () => {
		expect(StablePromotionRequestsModel.Create.Body.parse({})).toEqual({});
		expect(StablePromotionRequestsModel.Create.Body.parse({ message: " Fixes CVE-1 " })).toEqual({
			message: "Fixes CVE-1",
		});
	});

	test("rejects extra fields and empty messages in the create payload", () => {
		expect(() =>
			StablePromotionRequestsModel.Create.Body.parse({ package_release_id: 42 } as any),
		).toThrow();
		expect(() => StablePromotionRequestsModel.Create.Body.parse({ message: "   " })).toThrow();
	});

	test("reviewers can set pending, queued and denied, but not released", () => {
		for (const status of ["pending", "queued", "denied"]) {
			expect(AdminStablePromotionRequestModel.ChangeStatus.Body.parse({ status }).status).toBe(
				status as "pending",
			);
		}
		expect(() =>
			AdminStablePromotionRequestModel.ChangeStatus.Body.parse({ status: "released" }),
		).toThrow();
		expect(() =>
			AdminStablePromotionRequestModel.ChangeStatus.Body.parse({ status: "approved" }),
		).toThrow();
	});

	test("messages must not be empty or too long", () => {
		const { Body } = StablePromotionRequestsModel.CreateMessage;
		expect(Body.parse({ body: "**ok**" }).body).toBe("**ok**");
		expect(() => Body.parse({ body: "" })).toThrow();
		expect(() => Body.parse({ body: "x".repeat(10_001) })).toThrow();
	});
});
