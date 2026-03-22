import { createMiddleware } from 'hono/factory'
import { APIResponse } from "../../../utils/api-res";
import { AuthHandler } from '../../../utils/authHandler';

export const authMiddlewareV1 = createMiddleware(async (c, next) => {

    const authHeader = c.req.header("Authorization");

    if (!authHeader) {
        const authContext: AuthHandler.UnauthenticatedAuthContext = { type: 'unauthenticated' };

        c.set("authContext", authContext);

        return await next();
    }

    if (!authHeader.startsWith("Bearer ")) {
        return APIResponse.unauthorized(c, "Invalid Authorization header");
    }

    const token = authHeader.substring("Bearer ".length);

    const authContext: AuthHandler.AuthenticatedAuthContext | null = await AuthHandler.getAuthContext(token);

    if (!authContext || !(await AuthHandler.isValidAuthContext(authContext))) {
        return APIResponse.unauthorized(c, "Invalid or expired token");
    }

    c.set("authContext", authContext);

    return await next();

});