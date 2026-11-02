import { Hono } from "hono";
import { PermissionHelper } from "../../../../../utils/permission-helper";
import { APIResponse } from "../../../../utils/api-res";
import { AuthHandler } from "../../../../utils/authHandler";

export const router = new Hono().basePath("/admin");

// Staff gate: everything under /admin/* needs a site admin or moderator. Routes that only admins
// may use (OS release writes, tasks, account administration) also check PermissionHelper.isSiteAdmin.
router.use("*", async (c, next) => {
	const authContext = AuthHandler.AuthContext.get(c);

	if (authContext.type === "unauthenticated") {
		return APIResponse.unauthorized(c, "Authentication required");
	}
	if (!PermissionHelper.isSiteStaff(authContext)) {
		return APIResponse.forbidden(
			c,
			"This endpoint is restricted to site administrators and moderators",
		);
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
