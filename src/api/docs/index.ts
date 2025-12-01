import { Hono } from "hono";
import { type GenerateSpecOptions, openAPIRouteHandler } from "hono-openapi";
// import { SwaggerUI } from "@hono/swagger-ui";
import { Scalar } from '@scalar/hono-api-reference'

const openAPIConfig: Partial<GenerateSpecOptions> = {

    documentation: {
        info: {
            title: "NowIP API",
            version: "1.0.0",
            description: "API for NowIP Dynamic DNS service",
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
        // security: [{
        //     bearerAuth: []
        // }],

        servers: [
            {
                url: "http://localhost:3003",
                description: "Local development server",
            },
            {
                url: "https://api.nowip.is-on.net",
                description: "Production server",
            },
        ],
    },
}

export function setupDocs(app: Hono) {

    app.get(
        "/docs/openapi",
        openAPIRouteHandler(app, openAPIConfig),
    );

    // app.get('/docs', (c) => {
    //     return c.html(`
    //         <html lang="en">
    //         <head>
    //             <meta charset="utf-8" />
    //             <meta name="viewport" content="width=device-width, initial-scale=1" />
    //             <meta name="description" content="Custom Swagger" />
    //             <title>NowIP API Documentation</title>
    //             <style>
    //                 @layer base, ui, overrides;
    //             </style>
    //             </head>
    //             ${SwaggerUI({ url: '/docs/openapi', manuallySwaggerUIHtml: (asset) => `
    //                 <div>
    //                     <div id="swagger-ui"></div>
    //                     ${asset.css.map((url) => `<link rel="stylesheet" href="${url}" />`)}
    //                     <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/gh/teociaps/SwaggerUI.Themes/src/AspNetCore.Swagger.Themes.Common/AspNetCore/Swagger/Themes/Styles/modern.common.css" layer="overrides" />
    //                     <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/gh/teociaps/SwaggerUI.Themes/src/AspNetCore.Swagger.Themes.Common/AspNetCore/Swagger/Themes/Styles/modern.futuristic.css" layer="overrides" />
    //                     ${asset.js.map((url) => `<script src="${url}" crossorigin="anonymous"></script>`)}
    //                     <script src="https://cdn.jsdelivr.net/gh/teociaps/SwaggerUI.Themes/src/AspNetCore.Swagger.Themes.Common/AspNetCore/Swagger/Themes/Scripts/modern.js"></script>
    //                     <script>
    //                     window.onload = () => {
    //                         window.ui = SwaggerUIBundle({
    //                             dom_id: '#swagger-ui',
    //                             url: '/docs/openapi',
    //                         })
    //                     }
    //                     </script>
    //                 </div>
    //                 `})
    //         }
    //         </html>
    //     `)
    // });

    app.get('/docs', Scalar({ url: '/docs/openapi' }))

}
