import { Hono } from "hono";
import { APIVersionRouter } from "../../utils/apiVersionRouter";
import type { GenerateSpecOptions } from "hono-openapi";
import { router as publicRouter } from "./routes/public";
import { router as authRouter } from "./routes/auth";
import { router as accountRouter } from "./routes/account";
import { router as developerRouter } from "./routes/developer";
import { router as adminRouter } from "./routes/admin";

const openAPIConfig: Partial<GenerateSpecOptions> = {

    documentation: {
        info: {
            title: "LeiOS API",
            version: "1.1.0",
            description: "API for LeiOS Developers and Admins",
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

        // Disable global security because Scalar could not handle multiple security schemes properly
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
                name: "Public API",
                tags: [
                    "Public API / Packages",
                    // "Public API / Packages / Releases",
                ]
            },
            {
                name: "Developer API",
                tags: [
                    "Developer API / Publishers",
                    "Developer API / Publishers / Groups",
                    "Developer API / Publishers / Members",
                    "Developer API / Publishers / Packages",

                    "Developer API / Packages",
                    "Developer API / Packages / Releases",
                    "Developer API / Packages / Stable Promotion Requests",

                    "Developer API / Tasks",
                ],
            },
            {
                name: "Admin API",
                tags: [
                    "Admin API / Users",

                    "Admin API / Packages",
                    "Admin API / Packages / Releases",
                    "Admin API / Packages / Stable Promotion Requests",

                    "Admin API / Stable Promotion Requests",

                    "Admin API / OS Releases",

                    "Admin API / Tasks",
                ]
            },
            {
                name: "Account & Authentication",
                tags: [
                    "Account",
                    "Account / API Keys",
                    "Authentication",
                ]
            }
        ],

        tags: [
            // {
            //     name: "Public API",
            //     description: "Endpoints that do not require authentication",
            // },
            {
                name: "Public API / Packages",
                // @ts-ignore
                "x-displayName": "Packages",
                summary: "Packages",
                parent: "Public API",
                description: "Endpoints for public package access",
            },
            // {
            //     name: "Public API / Packages / Releases",
            //     // @ts-ignore
            //     "x-displayName": "Package Releases",
            //     summary: "Packages Releases",
            //     parent: "Public API / Packages",
            //     description: "Endpoints for public package releases",
            // },

            // {
            //     name: "Developer API",
            //     description: "Endpoints for authenticated developers",
            // },
            {
                name: "Developer API / Publishers",
                // @ts-ignore
                "x-displayName": "Publishers",
                summary: "Publishers",
                parent: "Developer API",
                description: "Endpoints for managing publishers (organizations/groups)",
            },
            {
                name: "Developer API / Publishers / Groups",
                // @ts-ignore
                "x-displayName": "Groups",
                summary: "Groups",
                parent: "Developer API / Publishers",
                description: "Endpoints for managing publisher subgroups",
            },
            {
                name: "Developer API / Publishers / Members",
                // @ts-ignore
                "x-displayName": "Members",
                summary: "Members",
                parent: "Developer API / Publishers",
                description: "Endpoints for managing publisher members and permissions",
            },
            {
                name: "Developer API / Publishers / Packages",
                // @ts-ignore
                "x-displayName": "Packages",
                summary: "Packages",
                parent: "Developer API / Publishers",
                description: "Endpoints for managing packages within publishers",
            },

            {
                name: "Developer API / Packages",
                // @ts-ignore
                "x-displayName": "Packages",
                summary: "Packages",
                parent: "Developer API",
                description: "Endpoints for developer package management",
            },
            {
                name: "Developer API / Packages / Releases",
                // @ts-ignore
                "x-displayName": "Package Releases",
                summary: "Releases",
                parent: "Developer API / Packages",
                description: "Endpoints for developer package releases",
            },
            {
                name: "Developer API / Packages / Stable Promotion Requests",
                // @ts-ignore
                "x-displayName": "Package Stable Promotion Requests",
                summary: "Stable Promotion Requests",
                parent: "Developer API / Packages",
                description: "Endpoints for managing stable promotion requests",
            },

            {
                name: "Developer API / Tasks",
                // @ts-ignore
                "x-displayName": "Tasks",
                summary: "Tasks",
                parent: "Developer API",
                description: "Endpoints for managing scheduled tasks",
            },

            // {
            //     name: "Admin API",
            //     description: "Endpoints for administrators",
            // },
            {
                name: "Admin API / Users",
                // @ts-ignore
                "x-displayName": "Users",
                summary: "Users",
                parent: "Admin API",
                description: "Endpoints for user management",
            },

            {
                name: "Admin API / Packages",
                // @ts-ignore
                "x-displayName": "Packages",
                summary: "Packages",
                parent: "Admin API",
                description: "Endpoints for admin package management",
            },
            {
                name: "Admin API / Packages / Releases",
                // @ts-ignore
                "x-displayName": "Package Releases",
                summary: "Releases",
                parent: "Admin API / Packages",
                description: "Endpoints for admin package releases",
            },
            {
                name: "Admin API / Packages / Stable Promotion Requests",
                // @ts-ignore
                "x-displayName": "Package Stable Promotion Requests",
                summary: "Stable Promotion Requests",
                parent: "Admin API / Packages",
                description: "Endpoints for managing stable promotion requests",
            },

            {
                name: "Admin API / Stable Promotion Requests",
                // @ts-ignore
                "x-displayName": "Stable Promotion Requests",
                summary: "Stable Promotion Requests",
                parent: "Admin API",
                description: "Endpoints for managing stable promotion requests",
            },

            {
                name: "Admin API / OS Releases",
                // @ts-ignore
                "x-displayName": "OS Releases",
                summary: "OS Releases",
                parent: "Admin API",
                description: "Endpoints for managing OS releases",
            },
            
            {
                name: "Admin API / Tasks",
                // @ts-ignore
                "x-displayName": "Tasks",
                summary: "Tasks",
                parent: "Admin API",
                description: "Endpoints for managing scheduled tasks",
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
            }
        ]
    }
}


export class APIv0Router extends APIVersionRouter {
    constructor() {
        super({
            version: 0,
            openAPIConfig,
            routes: [
                publicRouter,
                authRouter,
                accountRouter,
                developerRouter,
                adminRouter,
            ]
        });
    }
}
