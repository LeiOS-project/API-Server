import { createMiddleware } from 'hono/factory'
import { APIResponse } from "../utils/api-res";
import { SessionHandler } from '../utils/sessionHandler';

export const authMiddleware = createMiddleware(async (c, next) => {

    if (
        c.req.path.startsWith("/nic/update") ||
        c.req.path.startsWith("/auth/login") || c.req.path.startsWith("/auth/signup") ||

        c.req.path.startsWith("/docs") ||
        c.req.path.startsWith("/favicon.ico") ||
        c.req.path === "/"
    ) {
        await next();
    }

    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return APIResponse.unauthorized(c, "Missing or invalid Authorization header");
    }

    const token = authHeader.substring("Bearer ".length);
    const session = await SessionHandler.getSession(token);

    if (!session || !(await SessionHandler.isValidSession(session))) {
        return APIResponse.unauthorized(c, "Invalid or expired session");
    }

    c.set("session", session);

    await next();

});