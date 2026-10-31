import { Hono } from "hono";
import { APIResponse } from "../../../../utils/api-res";
import { AuthHandler } from "../../../../utils/authHandler";

export const router = new Hono().basePath("/admin");

// Site-admin gate. Everything under /admin/* requires user_role === 'admin'.
router.use("*", async (c, next) => {
	const authContext = AuthHandler.AuthContext.get(c);

	if (authContext.type === "unauthenticated") {
		return APIResponse.unauthorized(c, "Authentication required");
	}
	if (authContext.user_role !== "admin") {
		return APIResponse.forbidden(c, "This endpoint is restricted to site administrators");
	}

	await next();
});

router.route("/", (await import("./users")).router);
router.route("/", (await import("./os-releases")).router);
router.route("/", (await import("./tasks")).router);
router.route("/", (await import("./stable-promotion-requests")).router);
router.route("/", (await import("./publishers")).router);
router.route("/", (await import("./packages")).router);
router.route("/", (await import("./reports")).router);
router.route("/", (await import("./audit-log")).router);
router.route("/", (await import("./stats")).router);
