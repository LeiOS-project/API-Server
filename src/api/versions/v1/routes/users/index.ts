import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { like, or } from "drizzle-orm";
import { DB } from "../../../../../db";
import { APIResponse } from "../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { AuthHandler } from "../../../../utils/authHandler";
import { DOCS_TAGS } from "../../docs";
import { UsersPublicModel } from "./model";

export const router = new Hono().basePath('/users');

router.get('/search',

    APIRouteSpec.authenticated({
        summary: "Search users",
        description: "Search for LeiOS users by username or display name. Only returns minimal public info. Requires authentication.",
        tags: [DOCS_TAGS.USERS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Users retrieved successfully", UsersPublicModel.Search.Response),
            APIResponseSpec.unauthorized("Authentication required")
        )
    }),

    zValidator("query", UsersPublicModel.Search.Query),

    async (c) => {
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        if (authContext.type === 'unauthenticated') {
            return APIResponse.unauthorized(c, "Authentication required");
        }

        const { q, limit } = c.req.valid("query") as UsersPublicModel.Search.Query;

        const pattern = `%${q}%`;

        const users = await DB.instance()
            .select({
                id: DB.Tables.users.id,
                username: DB.Tables.users.username,
                display_name: DB.Tables.users.display_name,
            })
            .from(DB.Tables.users)
            .where(or(
                like(DB.Tables.users.username, pattern),
                like(DB.Tables.users.display_name, pattern),
            ))
            .limit(limit)
            .orderBy(DB.Tables.users.id);

        return APIResponse.success(c, "Users retrieved successfully", users satisfies UsersPublicModel.Search.Response);
    }
);
