import { Hono } from "hono";
import { type GenerateSpecOptions, openAPIRouteHandler } from "hono-openapi";
import { Scalar } from '@scalar/hono-api-reference'

const openAPIConfig: Partial<GenerateSpecOptions> = {

    documentation: {
        info: {
            title: "LeiOS API",
            version: "1.0.0",
            description: "API for LeiOS Developers and Admins",
        },
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                    description: "Enter your bearer token in the format **Bearer &lt;token&gt;**",
                },
                ddnsv2BasicAuth: {
                    type: "http",
                    scheme: "basic",
                    description: "Enter your DDNSv2 Basic Auth credentials",
                },
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
                url: "http://localhost:4000",
                description: "Local development server",
            },
            {
                url: "https://api.leios.dev",
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
                name: "Authentication",
                description: "Endpoints for authentication and authorization",
            }
        ]
    }
}

export function setupDocs(app: Hono) {

    app.get(
        "/docs/openapi",
        openAPIRouteHandler(app, openAPIConfig),
    );

    app.get('/docs', Scalar({ url: '/docs/openapi' }))

}

export const DOCS_TAGS = {
    PUBLIC_API: {
        BASE: "Public API",
        PACKAGES: "Public API / Packages",
        PACKAGES_RELEASES: "Public API / Packages / Releases",
    },
    DEV_API: {
        BASE: "Developer API",
        PACKAGES: "Developer API / Packages",
        PACKAGES_RELEASES: "Developer API / Packages / Releases",
        PACKAGES_STABLE_REQUESTS: "Developer API / Packages / Stable Promotion Requests",

        TASKS: "Developer API / Tasks",
    },
    ADMIN_API: {
        BASE: "Admin API",
        PACKAGES: "Admin API / Packages",
        PACKAGES_RELEASES: "Admin API / Packages / Releases",
        PACKAGES_STABLE_REQUESTS: "Admin API / Packages / Stable Promotion Requests",

        USERS: "Admin API / Users",
        STABLE_PROMOTION_REQUESTS: "Admin API / Stable Promotion Requests",

        OS_RELEASES: "Admin API / OS Releases",

        TASKS: "Admin API / Tasks",
    },
    ACCOUNT: "Account",
    AUTHENTICATION: "Authentication",
}