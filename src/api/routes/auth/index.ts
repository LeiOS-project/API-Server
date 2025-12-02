import { Hono } from "hono";
import { AuthModel } from './model'
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../db";
import { eq } from "drizzle-orm";
import { APIResponse } from "../../utils/api-res";
import { AuthHandler, SessionHandler } from "../../utils/authHandler";
import { APIResponseSpec, APIRouteSpec } from "../../utils/specHelpers";

export const router = new Hono().basePath('/auth');

router.post('/login',

    APIRouteSpec.unauthenticated({
        summary: "User Login",
        description: "Authenticate a user with their username and password",
        tags: ["Authentication"],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Login successful", AuthModel.Login.Response),
            APIResponseSpec.unauthorized("Unauthorized: Invalid username or password"),
        ),

    }),

    zValidator("json", AuthModel.Login.Body),
    
    async (c) => {
        const { username, password } = c.req.valid("json");

        const user = DB.instance().select().from(DB.Schema.users).where(eq(DB.Schema.users.username, username)).get();
        if (!user) {
            return APIResponse.unauthorized(c, "Invalid username or password");
        }

        const passwordMatch = await Bun.password.verify(password, user.password_hash);
        if (!passwordMatch) {
            return APIResponse.unauthorized(c, "Invalid username or password");
        }

        const session = await SessionHandler.createSession(user.id);

        return APIResponse.success(c, "Login successful", session);
    }
);

router.get('/session',

    APIRouteSpec.authenticated({
        summary: "Get Current Session",
        description: "Retrieve the current user's session information",
        tags: ["Authentication"],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Session info retrieved successfully", AuthModel.Session.Response),
            APIResponseSpec.unauthorized("Unauthorized: Invalid or missing session token / Your Auth Context is not a session"),
        )

    }),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        if (authContext.type !== 'session') {
            return APIResponse.unauthorized(c, "Your Auth Context is not a session");
        }

        return APIResponse.success(c, "Session info retrieved successfully", authContext);
    }
);

router.post('/logout',

    APIRouteSpec.authenticated({
        summary: "User Logout",
        description: "Invalidate the current user's session",
        tags: ["Authentication"],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Logout successful"),
            APIResponseSpec.unauthorized("Unauthorized: Invalid or missing session token / Your Auth Context is not a session"),
        )

    }),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        if (authContext.type !== 'session') {
            return APIResponse.unauthorized(c, "Your Auth Context is not a session");
        }

        await SessionHandler.inValidateSession(authContext.token);

        return APIResponse.successNoData(c, "Logout successful");
    }
);