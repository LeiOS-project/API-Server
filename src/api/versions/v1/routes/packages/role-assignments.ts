import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { DB } from "../../../../../db";
import { APIResponse } from "../../../../utils/api-res";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { AuthHandler } from "../../../../utils/authHandler";
import { PermissionHelper } from "../../../../../utils/permission-helper";
import { PackageModel } from "../../../../utils/shared-models/package";
import { DOCS_TAGS } from "../../docs";

export const router = new Hono().basePath('/role-assignments');


/**
 * Fetch the current publisher-level role for a user, treating publisher ownership
 * as ADMIN. Returns `null` when the user has no relationship with the publisher.
 */
async function getPublisherLevelRole(publisherId: number, ownerUserId: number, userId: number): Promise<PermissionHelper.OrgRoles | null> {
    if (userId === ownerUserId) {
        return PermissionHelper.OrgRoles.ADMIN;
    }
    const membership = await DB.instance()
        .select({ role: DB.Tables.publisherMembers.role })
        .from(DB.Tables.publisherMembers)
        .where(and(
            eq(DB.Tables.publisherMembers.publisher_id, publisherId),
            eq(DB.Tables.publisherMembers.user_id, userId)
        ))
        .get();
    return membership?.role ?? null;
}

router.get('/',

    APIRouteSpec.authenticated({
        summary: "List package role assignments",
        description: "List all per-package role assignments for this package. Requires members.invite permission on the parent publisher.",
        tags: [DOCS_TAGS.PACKAGES_ROLE_ASSIGNMENTS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.success("Role assignments retrieved successfully", PackageModel.ListRoleAssignments.Response),
            APIResponseSpec.forbidden("You do not have permission to view role assignments for this package")
        )
    }),

    async (c) => {
        // @ts-ignore
        const pkg = c.get("package") as DB.Models.PackageFullView;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: pkg.publisher_id,
            check: (p) => p.members.invite
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to view role assignments for this package");
        }

        const publisher = await DB.instance()
            .select({ owner_user_id: DB.Tables.publishers.owner_user_id })
            .from(DB.Tables.publishers)
            .where(eq(DB.Tables.publishers.id, pkg.publisher_id))
            .get();

        if (!publisher) {
            throw new Error("Publisher not found for package");
        }

        const publisher_owner_user_id = publisher.owner_user_id;

        const rawAssignments = await DB.instance()
            .select({
                id: DB.Tables.roleAssignments.id,
                package_id: DB.Tables.roleAssignments.package_id,
                user_id: DB.Tables.roleAssignments.user_id,
                role: DB.Tables.roleAssignments.role,
                created_at: DB.Tables.roleAssignments.created_at,
                user_username: DB.Tables.users.username,
                user_display_name: DB.Tables.users.display_name,
                publisher_role: DB.Tables.publisherMembers.role,
            })
            .from(DB.Tables.roleAssignments)
            .innerJoin(DB.Tables.users, eq(DB.Tables.users.id, DB.Tables.roleAssignments.user_id))
            .leftJoin(DB.Tables.publisherMembers, and(
                eq(DB.Tables.publisherMembers.publisher_id, pkg.publisher_id),
                eq(DB.Tables.publisherMembers.user_id, DB.Tables.roleAssignments.user_id)
            ))
            .where(eq(DB.Tables.roleAssignments.package_id, pkg.id));

        // Publisher owners don't have a publisher_members row, so we set their role to ADMIN manually
        const assignments = rawAssignments.map((a) => ({
            ...a,
            publisher_role: a.user_id === publisher_owner_user_id ? PermissionHelper.OrgRoles.ADMIN : a.publisher_role,
        }));

        return APIResponse.success(c, "Role assignments retrieved successfully", assignments satisfies PackageModel.ListRoleAssignments.Response);
    }
);

router.post('/',

    APIRouteSpec.authenticated({
        summary: "Create package role assignment",
        description: "Grant a user a package-scoped role. The new role must be strictly higher than the user's existing publisher-level role. Requires members.updateRole permission on the parent publisher.",
        tags: [DOCS_TAGS.PACKAGES_ROLE_ASSIGNMENTS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.createdNoData("Role assignment created successfully"),
            APIResponseSpec.conflict("User already has a role assignment for this package"),
            APIResponseSpec.forbidden("You do not have permission to manage role assignments for this package"),
            APIResponseSpec.notFound("User not found"),
            APIResponseSpec.badRequest("Package-level role must be strictly higher than the user's publisher-level role")
        )
    }),

    zValidator("json", PackageModel.CreateRoleAssignment.Body),

    async (c) => {
        // @ts-ignore
        const pkg = c.get("package") as DB.Models.PackageFullView;
        
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        const body = c.req.valid("json");

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: pkg.publisher_id,
            check: (p) => p.members.update
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to manage role assignments for this package");
        }

        const user = await DB.instance()
            .select({ id: DB.Tables.users.id })
            .from(DB.Tables.users)
            .where(eq(DB.Tables.users.id, body.user_id))
            .get();
        if (!user) {
            return APIResponse.notFound(c, "User not found");
        }

        const publisher_owner_user_id = await DB.instance()
            .select({ owner_user_id: DB.Tables.publishers.owner_user_id })
            .from(DB.Tables.publishers)
            .where(eq(DB.Tables.publishers.id, pkg.publisher_id))
            .get()?.owner_user_id;

        if (!publisher_owner_user_id) {
            throw new Error("Publisher not found for package"); // This should never happen since the package exists, but we need this data for the role comparison below
        }

        const publisherRole = await getPublisherLevelRole(pkg.publisher_id, publisher_owner_user_id, body.user_id);
        if (publisherRole !== null && PermissionHelper.compareRoles(body.role, publisherRole) <= 0) {
            return APIResponse.badRequest(c, "Package-level role must be strictly higher than the user's publisher-level role");
        }

        const existing = await DB.instance()
            .select({ id: DB.Tables.roleAssignments.id })
            .from(DB.Tables.roleAssignments)
            .where(and(
                eq(DB.Tables.roleAssignments.package_id, pkg.id),
                eq(DB.Tables.roleAssignments.user_id, body.user_id)
            ))
            .get();

        if (existing) {
            return APIResponse.conflict(c, "User already has a role assignment for this package");
        }

        await DB.instance().insert(DB.Tables.roleAssignments).values({
            package_id: pkg.id,
            user_id: body.user_id,
            role: body.role
        });

        return APIResponse.createdNoData(c, "Role assignment created successfully");
    }
);

router.put('/:userId',

    APIRouteSpec.authenticated({
        summary: "Update package role assignment",
        description: "Update an existing package-scoped role for a user. The new role must be strictly higher than the user's publisher-level role.",
        tags: [DOCS_TAGS.PACKAGES_ROLE_ASSIGNMENTS],

        responses: APIResponseSpec.describeWithWrongInputs(
            APIResponseSpec.successNoData("Role assignment updated successfully"),
            APIResponseSpec.notFound("Role assignment not found"),
            APIResponseSpec.forbidden("You do not have permission to manage role assignments for this package"),
            APIResponseSpec.badRequest("Package-level role must be strictly higher than the user's publisher-level role")
        )
    }),

    zValidator("param", z.object({
        userId: z.coerce.number().int().positive()
    })),

    zValidator("json", PackageModel.UpdateRoleAssignment.Body),

    async (c) => {
        // @ts-ignore
        const pkg = c.get("package") as DB.Models.PackageFullView;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        // @ts-ignore
        const { userId } = c.req.valid("param") as { userId: number };
        const body = c.req.valid("json");

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: pkg.publisher_id,
            check: (p) => p.members.update
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to manage role assignments for this package");
        }

        const assignment = await DB.instance()
            .select({ id: DB.Tables.roleAssignments.id })
            .from(DB.Tables.roleAssignments)
            .where(and(
                eq(DB.Tables.roleAssignments.package_id, pkg.id),
                eq(DB.Tables.roleAssignments.user_id, userId)
            ))
            .get();

        if (!assignment) {
            return APIResponse.notFound(c, "Role assignment not found");
        }

        const publisher_owner_user_id = await DB.instance()
            .select({ owner_user_id: DB.Tables.publishers.owner_user_id })
            .from(DB.Tables.publishers)
            .where(eq(DB.Tables.publishers.id, pkg.publisher_id))
            .get()?.owner_user_id;

        if (!publisher_owner_user_id) {
            throw new Error("Publisher not found for package"); // This should never happen since the package exists, but we need this data for the role comparison below
        }

        const publisherRole = await getPublisherLevelRole(pkg.publisher_id, publisher_owner_user_id, userId);
        if (publisherRole !== null && PermissionHelper.compareRoles(body.role, publisherRole) <= 0) {
            return APIResponse.badRequest(c, "Package-level role must be strictly higher than the user's publisher-level role");
        }

        await DB.instance()
            .update(DB.Tables.roleAssignments)
            .set({ role: body.role })
            .where(eq(DB.Tables.roleAssignments.id, assignment.id));

        return APIResponse.successNoData(c, "Role assignment updated successfully");
    }
);

router.delete('/:userId',

    APIRouteSpec.authenticated({
        summary: "Delete package role assignment",
        description: "Remove a package-scoped role assignment. Requires members.updateRole permission on the parent publisher.",
        tags: [DOCS_TAGS.PACKAGES_ROLE_ASSIGNMENTS],

        responses: APIResponseSpec.describeBasic(
            APIResponseSpec.successNoData("Role assignment deleted successfully"),
            APIResponseSpec.notFound("Role assignment not found"),
            APIResponseSpec.forbidden("You do not have permission to manage role assignments for this package")
        )
    }),

    zValidator("param", z.object({
        userId: z.coerce.number().int().positive()
    })),

    async (c) => {
        // @ts-ignore
        const pkg = c.get("package") as DB.Models.PackageFullView;
        // @ts-ignore
        const authContext = c.get("authContext") as AuthHandler.AuthContext;
        // @ts-ignore
        const { userId } = c.req.valid("param") as { userId: number };

        const allowed = await PermissionHelper.can({
            authContext,
            publisherId: pkg.publisher_id,
            check: (p) => p.members.update
        });

        if (!allowed) {
            return APIResponse.forbidden(c, "You do not have permission to manage role assignments for this package");
        }

        const assignment = await DB.instance()
            .select({ id: DB.Tables.roleAssignments.id })
            .from(DB.Tables.roleAssignments)
            .where(and(
                eq(DB.Tables.roleAssignments.package_id, pkg.id),
                eq(DB.Tables.roleAssignments.user_id, userId)
            ))
            .get();

        if (!assignment) {
            return APIResponse.notFound(c, "Role assignment not found");
        }

        await DB.instance().delete(DB.Tables.roleAssignments).where(
            eq(DB.Tables.roleAssignments.id, assignment.id)
        );

        return APIResponse.successNoData(c, "Role assignment deleted successfully");
    }
);
