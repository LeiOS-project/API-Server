import { Hono } from "hono";
import { Model } from './model'
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../db";
import { eq } from "drizzle-orm";
import { APIResponse } from "../../utils/api-res";
import { SessionHandler } from "../../utils/sessionHandler";
import { APIResponseSpec, APIRouteSpec } from "../../utils/specHelpers";

export const router = new Hono().basePath('/auth');

router.post('/login',

    APIRouteSpec.unauthenticated({
        summary: "User Login",
        description: "Authenticate a user with their username and password",
        tags: ["Authentication"],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.success("Login successful", Model.Login.Response),
            APIResponseSpec.unauthorized("Unauthorized: Invalid username or password"),
        ),

    }),

    zValidator("json", Model.Login.Body),
    
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
            APIResponseSpec.success("Session info retrieved successfully", Model.Session.Response),
            APIResponseSpec.unauthorized("Unauthorized: Invalid or missing session token"),
        )

    }),

    async (c) => {
        // @ts-ignore
        const session = c.get("session") as DB.Models.Session;

        return APIResponse.success(c, "Session info retrieved successfully", session);
    }
);

router.post('/logout',

    APIRouteSpec.authenticated({
        summary: "User Logout",
        description: "Invalidate the current user's session",
        tags: ["Authentication"],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Logout successful"),
            APIResponseSpec.unauthorized("Unauthorized: Invalid or missing session token"),
        )

    }),

    async (c) => {
        // @ts-ignore
        const session = c.get("session") as DB.Models.Session;

        await SessionHandler.invalidateSession(session.token);

        return APIResponse.successNoData(c, "Logout successful");
    }
);