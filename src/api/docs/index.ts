import { Hono } from "hono";
import { type GenerateSpecOptions, openAPIRouteHandler } from "hono-openapi";
import { Scalar } from '@scalar/hono-api-reference'

const openAPIConfig: Partial<GenerateSpecOptions> = {

    documentation: {
        info: {
            title: "LeiOS Repo API",
            version: "1.0.0",
            description: "API for LeiOS Repo",
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
                url: "https://api.repo.leios.dev",
                description: "Production server",
            },
        ],

        tags: [
            {
                name: "Public API",
                description: "Endpoints that do not require authentication",
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
    },
    ADMIN_API: {
        BASE: "Admin API",
        PACKAGES: "Admin API / Packages",
        PACKAGES_RELEASES: "Admin API / Packages / Releases",
        PACKAGES_STABLE_REQUESTS: "Admin API / Packages / Stable Promotion Requests",

        USERS: "Admin API / Users",
        STABLE_PROMOTION_REQUESTS: "Admin API / Stable Promotion Requests",
    }
}