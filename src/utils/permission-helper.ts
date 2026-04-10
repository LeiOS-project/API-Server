import { and, eq } from "drizzle-orm";
import { DB } from "../db";
import type { AuthHandler } from "../api/utils/authHandler";

export class PermissionHelper {

    /**
     * Return the highest of two roles (ordered ADMIN > MAINTAINER > DEVELOPER > VIEWER).
     * `null` means "no role", and anything non-null beats it.
     */
    static compareRoles(
        a: PermissionHelper.OrgRoles | null,
        b: PermissionHelper.OrgRoles | null
    ): -1 | 0 | 1 {
        const ai = a === null ? -1 : PermissionHelper.RolePrecedence.indexOf(a);
        const bi = b === null ? -1 : PermissionHelper.RolePrecedence.indexOf(b);
        // Lower index = higher role
        if (ai === bi) return 0;
        // A is higher if its index is smaller (but -1 means "none" and is lowest)
        const aRank = ai === -1 ? -1 : PermissionHelper.RolePrecedence.length - ai;
        const bRank = bi === -1 ? -1 : PermissionHelper.RolePrecedence.length - bi;
        if (aRank > bRank) return 1;
        if (aRank < bRank) return -1;
        return 0;
    }

    /**
     * Pick the higher of two roles. `null` is treated as "no role".
     */
    static maxRole(
        a: PermissionHelper.OrgRoles | null,
        b: PermissionHelper.OrgRoles | null
    ): PermissionHelper.OrgRoles | null {
        if (a === null) return b;
        if (b === null) return a;
        return this.compareRoles(a, b) >= 0 ? a : b;
    }

    /**
     * Whether the given user owns the publisher (i.e. publishers.owner_user_id === userId).
     */
    static async isPublisherOwner(params: {
        userId: number;
        publisherId: number;
    }): Promise<boolean> {
        const row = await DB.instance()
            .select({ owner_user_id: DB.Tables.publishers.owner_user_id })
            .from(DB.Tables.publishers)
            .where(eq(DB.Tables.publishers.id, params.publisherId))
            .get();
        return row?.owner_user_id === params.userId;
    }

    /**
     * Resolve the effective role for a user against a publisher (and optionally a
     * specific package). Returns the highest of:
     *   - publisherMembers.role for (userId, publisherId)
     *   - roleAssignments.role for (userId, packageId) when packageId is given
     * Publisher ownership and site-admin bypass are NOT applied here; callers
     * that need those shortcuts should use `can`.
     */
    static async getEffectiveRole(params: {
        userId: number;
        publisherId: number;
        packageId?: number;
    }): Promise<PermissionHelper.OrgRoles | null> {
        const { userId, publisherId, packageId } = params;

        const membership = await DB.instance()
            .select({ role: DB.Tables.publisherMembers.role })
            .from(DB.Tables.publisherMembers)
            .where(and(
                eq(DB.Tables.publisherMembers.user_id, userId),
                eq(DB.Tables.publisherMembers.publisher_id, publisherId)
            ))
            .get();

        let role: PermissionHelper.OrgRoles | null = membership?.role ?? null;

        if (packageId !== undefined) {
            const assignment = await DB.instance()
                .select({ role: DB.Tables.roleAssignments.role })
                .from(DB.Tables.roleAssignments)
                .where(and(
                    eq(DB.Tables.roleAssignments.user_id, userId),
                    eq(DB.Tables.roleAssignments.package_id, packageId)
                ))
                .get();

            role = this.maxRole(role, assignment?.role ?? null);
        }

        return role;
    }

    /**
     * Effective permission bag for a user in a publisher/package scope.
     * Returns `null` if the user has no role at all in that scope.
     */
    static async getEffectivePermissions(params: {
        userId: number;
        publisherId: number;
        packageId?: number;
    }): Promise<PermissionHelper.OrgPermissions | null> {
        const role = await this.getEffectiveRole(params);
        if (role === null) return null;
        return PermissionHelper.RolePermissions[role];
    }

    /**
     * Main permission check. Semantics:
     *   1. unauthenticated          → false
     *   2. site admin               → true
     *   3. publisher owner          → true
     *   4. else use effective perms
     */
    static async can(params: {
        authContext: AuthHandler.AuthContext;
        publisherId: number;
        packageId?: number;
        permission: (perms: PermissionHelper.OrgPermissions) => boolean;
    }): Promise<boolean> {
        const { authContext, publisherId, packageId, permission } = params;

        if (authContext.type === 'unauthenticated') return false;
        if (authContext.user_role === 'admin') return true;

        if (await this.isPublisherOwner({ userId: authContext.user_id, publisherId })) {
            return true;
        }

        const perms = await this.getEffectivePermissions({
            userId: authContext.user_id,
            publisherId,
            packageId
        });
        if (!perms) return false;
        return !!permission(perms);
    }

}

export namespace PermissionHelper {

    export enum OrgRoles {
        ADMIN = "ADMIN",
        MAINTAINER = "MAINTAINER",
        DEVELOPER = "DEVELOPER",
        VIEWER = "VIEWER"
    }

    export const OrgRolesAsTuple = [OrgRoles.ADMIN, OrgRoles.MAINTAINER, OrgRoles.DEVELOPER, OrgRoles.VIEWER] as const;

    /** Highest → lowest precedence. Used by compareRoles/maxRole. */
    export const RolePrecedence = [
        OrgRoles.ADMIN,
        OrgRoles.MAINTAINER,
        OrgRoles.DEVELOPER,
        OrgRoles.VIEWER
    ] as const;

    export interface OrgPermissions {

        publisher: {
            update: boolean;
            // Delete is always owner-only; kept here so the shape is explicit.
            delete: boolean;
        }

        packages: {
            create: boolean;
            update: boolean;
            delete: boolean;

            releases: {
                publish: boolean;
                update: boolean;
                delete: boolean;

                requestStable: boolean;
            }

            requestTopLevelAlias: boolean;
        }

        members: {
            invite: boolean;
            remove: boolean;
            updateRole: boolean;
        }

    }

    export const RolePermissions = {

        [OrgRoles.ADMIN]: {
            publisher: {
                update: true,
                delete: false
            },
            packages: {
                create: true,
                update: true,
                delete: true,
                releases: {
                    publish: true,
                    update: true,
                    delete: true,
                    requestStable: true
                },
                requestTopLevelAlias: true
            },
            members: {
                invite: true,
                remove: true,
                updateRole: true
            }
        },

        [OrgRoles.MAINTAINER]: {
            publisher: {
                update: false,
                delete: false
            },
            packages: {
                create: true,
                update: true,
                delete: false,
                releases: {
                    publish: true,
                    update: true,
                    delete: false,
                    requestStable: true
                },
                requestTopLevelAlias: false
            },
            members: {
                invite: false,
                remove: false,
                updateRole: false
            }
        },

        [OrgRoles.DEVELOPER]: {
            publisher: {
                update: false,
                delete: false
            },
            packages: {
                create: true,
                update: false,
                delete: false,
                releases: {
                    publish: true,
                    update: false,
                    delete: false,
                    requestStable: true
                },
                requestTopLevelAlias: false
            },
            members: {
                invite: false,
                remove: false,
                updateRole: false
            }
        },

        [OrgRoles.VIEWER]: {
            publisher: {
                update: false,
                delete: false
            },
            packages: {
                create: false,
                update: false,
                delete: false,
                releases: {
                    publish: false,
                    update: false,
                    delete: false,
                    requestStable: false
                },
                requestTopLevelAlias: false
            },
            members: {
                invite: false,
                remove: false,
                updateRole: false
            }
        }
    } as const satisfies Record<OrgRoles, OrgPermissions>;

}
