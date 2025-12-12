import { Hono } from "hono";
import { AuthHandler } from "../../utils/authHandler";
import { APIResponse } from "../../utils/api-res";

export const router = new Hono().basePath('/dev');

router.use("*", async (c, next) => {
    // @ts-ignore
    const authContext = c.get("authContext") as AuthHandler.AuthContext;

    if (authContext.user_role !== 'developer' && authContext.user_role !== 'admin') {
        return APIResponse.unauthorized(c, "This endpoint is restricted to certified LeiOS developers and admins.");
    }

    await next();
});

router.route("/", (await import('./packages')).router);
router.route("/", (await import('./tasks')).router);
