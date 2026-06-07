import { Hono } from "hono";
import { APIVersionRouter } from "../../utils/apiVersionRouter";
import type { GenerateSpecOptions } from "hono-openapi";
import { router as authRouter } from "./routes/auth";
import { router as accountRouter } from "./routes/account";
import { router as publishersRouter } from "./routes/publishers";
import { router as packagesRouter } from "./routes/packages";
import { router as adminRouter } from "./routes/admin";
import { router as usersRouter } from "./routes/users";
import { authMiddlewareV1 } from "./middleware/auth";

const openAPIConfig: Partial<GenerateSpecOptions> = {

    documentation: {
        info: {
            title: "LeiOS API",
            version: "1.1.0",
            description: "Unified LeiOS API. Endpoints are scoped by resource and gated by per-route permission checks.",
        },
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                    description: "Enter your bearer token in the format **Bearer &lt;token&gt;**",
                }
            },
            responses: {
                undefined: {
                    description: "Authentication information is missing or invalid",
                },
            },
        },

        security: [{
            bearerAuth: []
        }],

        servers: [
            {
                url: "http://localhost:12151/v1/",
                description: "Local development server",
            },
            {
                url: "https://api.leios.dev/v1/",
                description: "Production server",
            },
        ],

        "x-tagGroups": [
            {
                name: "Resources",
                tags: [
                    "Publishers",
                    "Publishers / Members",
                    "Packages",
                    "Packages / Releases",
                    "Packages / Stable Promotion Requests",
                    "Packages / Role Assignments",
                    "Users",
                ],
            },
            {
                name: "Admin",
                tags: [
                    "Admin / Users",
                    "Admin / OS Releases",
                    "Admin / Tasks",
                    "Admin / Stable Promotion Requests",
                ],
            },
            {
                name: "Account & Authentication",
                tags: [
                    "Account",
                    "Account / API Keys",
                    "Authentication",
                ],
            },
        ],

        tags: [
            {
                name: "Publishers",
                description: "Manage publishers (organizations) and their members.",
            },
            {
                name: "Publishers / Members",
                // @ts-ignore
                "x-displayName": "Members",
                summary: "Members",
                parent: "Publishers",
                description: "Manage members of a publisher.",
            },
            {
                name: "Packages",
                description: "Manage packages owned by publishers.",
            },
            {
                name: "Packages / Releases",
                // @ts-ignore
                "x-displayName": "Releases",
                summary: "Releases",
                parent: "Packages",
                description: "Manage package releases.",
            },
            {
                name: "Packages / Stable Promotion Requests",
                // @ts-ignore
                "x-displayName": "Stable Promotion Requests",
                summary: "Stable Promotion Requests",
                parent: "Packages",
                description: "Request promotion of package releases to stable.",
            },
            {
                name: "Packages / Role Assignments",
                // @ts-ignore
                "x-displayName": "Role Assignments",
                summary: "Role Assignments",
                parent: "Packages",
                description: "Per-package role overrides that elevate a user above their publisher-level role.",
            },
            {
                name: "Admin / Users",
                // @ts-ignore
                "x-displayName": "Users",
                summary: "Users",
                parent: "Admin",
                description: "Site-admin user management.",
            },
            {
                name: "Admin / OS Releases",
                // @ts-ignore
                "x-displayName": "OS Releases",
                summary: "OS Releases",
                parent: "Admin",
                description: "Site-admin OS release management.",
            },
            {
                name: "Admin / Tasks",
                // @ts-ignore
                "x-displayName": "Tasks",
                summary: "Tasks",
                parent: "Admin",
                description: "Site-admin scheduled task management.",
            },
            {
                name: "Admin / Stable Promotion Requests",
                // @ts-ignore
                "x-displayName": "Stable Promotion Requests",
                summary: "Stable Promotion Requests",
                parent: "Admin",
                description: "Site-admin global stable promotion request decisions.",
            },
            {
                name: "Account",
                description: "Endpoints for user account management",
            },
            {
                name: "Account / API Keys",
                // @ts-ignore
                "x-displayName": "API Keys",
                summary: "API Keys",
                parent: "Account",
                description: "Endpoints for managing account API keys",
            },
            {
                name: "Authentication",
                description: "Endpoints for authentication and authorization",
            },
            {
                name: "Users",
                description: "Public user search, allowing authenticated users to find other users.",
            }
        ]
    }
};

const router = new Hono();

router.use(authMiddlewareV1);

router.route("/", authRouter);
router.route("/", accountRouter);
router.route("/", publishersRouter);
router.route("/", packagesRouter);
router.route("/", adminRouter);
router.route("/", usersRouter);

export class APIv1Router extends APIVersionRouter {
    constructor() {
        super({
            version: 1,
            openAPIConfig,
            routes: router
        });
    }
}
