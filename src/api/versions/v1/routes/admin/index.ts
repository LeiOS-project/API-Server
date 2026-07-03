import { Hono } from "hono";
import { APIResponse } from "../../../../utils/api-res";
import { AuthHandler } from "../../../../utils/authHandler";
import { router as usersRouter } from "./users";
import { router as osReleasesRouter } from "./os-releases";
import { router as tasksRouter } from "./tasks";
import { router as stablePromotionRequestsRouter } from "./stable-promotion-requests";

export const router = new Hono().basePath('/admin');

// Site-admin gate. Everything under /admin/* requires user_role === 'admin'.
router.use('*', async (c, next) => {
    // @ts-ignore
    const authContext = c.get("authContext") as AuthHandler.AuthContext;

    if (authContext.type === 'unauthenticated') {
        return APIResponse.unauthorized(c, "Authentication required");
    }
    if (authContext.user_role !== 'admin') {
        return APIResponse.forbidden(c, "This endpoint is restricted to site administrators");
    }

    await next();
});

router.route('/', usersRouter);
router.route('/', osReleasesRouter);
router.route('/', tasksRouter);
router.route('/', stablePromotionRequestsRouter);
