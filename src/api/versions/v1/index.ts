import { Hono } from "hono";
import type { GenerateSpecOptions } from "hono-openapi";
import { AppConstants } from "../../../utils/constants";
import { APIVersionRouter } from "../../utils/apiVersionRouter";
import { DOCS_TAGS } from "./docs";
import { authMiddlewareV1 } from "./middleware/auth";
import { router as accountRouter } from "./routes/account";
import { router as adminRouter } from "./routes/admin";
import { router as authRouter } from "./routes/auth";
import { router as packagesRouter } from "./routes/packages";
import { router as publishersRouter } from "./routes/publishers";
import { router as usersRouter } from "./routes/users";

const openAPIConfig: Partial<GenerateSpecOptions> = {
	documentation: {
		info: {
			title: `${AppConstants.APP_NAME} API`,
			version: "1.1.0",
			description:
				"Unified LeiOS API. Endpoints are scoped by resource and gated by per-route permission checks.",
		},
		components: {
			securitySchemes: {
				bearerAuth: {
					type: "http",
					scheme: "bearer",
					description: "Enter your bearer token in the format **Bearer &lt;token&gt;**",
				},
			},
		},

		security: [
			{
				bearerAuth: [],
			},
		],

		servers: [
			{
				url: `http://localhost:${AppConstants.APP_API_DEFAULT_PORT}/v1`,
				description: "Local development server",
			},
			{
				url: `${AppConstants.APP_API_DEFAULT_PROD_URL}/v1`,
				description: "Production server",
			},
		],

		"x-tagGroups": [
			{
				name: "Resources",
				tags: [
					DOCS_TAGS.PUBLISHERS,
					DOCS_TAGS.PUBLISHERS_MEMBERS,
					DOCS_TAGS.PACKAGES,
					DOCS_TAGS.PACKAGES_RELEASES,
					DOCS_TAGS.PACKAGES_STABLE_REQUESTS,
					DOCS_TAGS.PACKAGES_ROLE_ASSIGNMENTS,
					DOCS_TAGS.USERS,
				],
			},
			{
				name: "Admin",
				tags: [
					DOCS_TAGS.ADMIN_USERS,
					DOCS_TAGS.ADMIN_OS_RELEASES,
					DOCS_TAGS.ADMIN_TASKS,
					DOCS_TAGS.ADMIN_STABLE_PROMOTION_REQUESTS,
				],
			},
			{
				name: "Account & Authentication",
				tags: [DOCS_TAGS.ACCOUNT, DOCS_TAGS.ACCOUNT_API_KEYS, DOCS_TAGS.AUTHENTICATION],
			},
		],

		tags: [
			{
				name: DOCS_TAGS.PUBLISHERS,
				description: "Manage publishers (organizations) and their members.",
			},
			{
				name: DOCS_TAGS.PUBLISHERS_MEMBERS,
				// @ts-expect-error - Scalar\'s x-displayName is not part of the OpenAPI tag type
				"x-displayName": "Members",
				summary: "Members",
				parent: DOCS_TAGS.PUBLISHERS,
				description: "Manage members of a publisher.",
			},
			{
				name: DOCS_TAGS.PACKAGES,
				description: "Manage packages owned by publishers.",
			},
			{
				name: DOCS_TAGS.PACKAGES_RELEASES,
				// @ts-expect-error - Scalar\'s x-displayName is not part of the OpenAPI tag type
				"x-displayName": "Releases",
				summary: "Releases",
				parent: DOCS_TAGS.PACKAGES,
				description: "Manage package releases.",
			},
			{
				name: DOCS_TAGS.PACKAGES_STABLE_REQUESTS,
				// @ts-expect-error - Scalar\'s x-displayName is not part of the OpenAPI tag type
				"x-displayName": "Stable Promotion Requests",
				summary: "Stable Promotion Requests",
				parent: DOCS_TAGS.PACKAGES,
				description: "Request promotion of package releases to stable.",
			},
			{
				name: DOCS_TAGS.PACKAGES_ROLE_ASSIGNMENTS,
				// @ts-expect-error - Scalar\'s x-displayName is not part of the OpenAPI tag type
				"x-displayName": "Role Assignments",
				summary: "Role Assignments",
				parent: DOCS_TAGS.PACKAGES,
				description: "Per-package role overrides that elevate a user above their publisher-level role.",
			},
			{
				name: DOCS_TAGS.ADMIN_USERS,
				// @ts-expect-error - Scalar\'s x-displayName is not part of the OpenAPI tag type
				"x-displayName": DOCS_TAGS.USERS,
				summary: DOCS_TAGS.USERS,
				parent: "Admin",
				description: "Site-admin user management.",
			},
			{
				name: DOCS_TAGS.ADMIN_OS_RELEASES,
				// @ts-expect-error - Scalar\'s x-displayName is not part of the OpenAPI tag type
				"x-displayName": "OS Releases",
				summary: "OS Releases",
				parent: "Admin",
				description: "Site-admin OS release management.",
			},
			{
				name: DOCS_TAGS.ADMIN_TASKS,
				// @ts-expect-error - Scalar\'s x-displayName is not part of the OpenAPI tag type
				"x-displayName": "Tasks",
				summary: "Tasks",
				parent: "Admin",
				description: "Site-admin scheduled task management.",
			},
			{
				name: DOCS_TAGS.ADMIN_STABLE_PROMOTION_REQUESTS,
				// @ts-expect-error - Scalar\'s x-displayName is not part of the OpenAPI tag type
				"x-displayName": "Stable Promotion Requests",
				summary: "Stable Promotion Requests",
				parent: "Admin",
				description: "Site-admin global stable promotion request decisions.",
			},
			{
				name: DOCS_TAGS.ACCOUNT,
				description: "Endpoints for user account management",
			},
			{
				name: DOCS_TAGS.ACCOUNT_API_KEYS,
				// @ts-expect-error - Scalar\'s x-displayName is not part of the OpenAPI tag type
				"x-displayName": "API Keys",
				summary: "API Keys",
				parent: DOCS_TAGS.ACCOUNT,
				description: "Endpoints for managing account API keys",
			},
			{
				name: DOCS_TAGS.AUTHENTICATION,
				description: "Endpoints for authentication and authorization",
			},
			{
				name: DOCS_TAGS.USERS,
				description: "Public user search, allowing authenticated users to find other users.",
			},
		],
	},
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
			routes: router,
		});
	}
}
