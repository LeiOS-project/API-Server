import { beforeAll, describe, expect, test } from "bun:test";
import { PermissionHelper } from "../src/utils/permission-helper";
import { AuthHandler } from "../src/api/utils/authHandler";
import {
    seedUser,
    seedPublisher,
    seedPackage,
    seedMembership,
    seedPackageRoleAssignment,
    type SeededUser,
} from "./helpers/seed";
import { DB } from "../src/db";

const { OrgRoles } = PermissionHelper;

type AuthCtx = AuthHandler.AuthContext;

function fakeAuth(user: SeededUser): AuthHandler.SessionAuthContext {
    return {
        type: "session",
        id: "fake",
        hashed_token: "",
        user_id: user.id,
        user_role: user.role,
        created_at: Date.now(),
        expires_at: Date.now() + 1000 * 60 * 60,
    };
}

describe("PermissionHelper.compareRoles", () => {
    test("ADMIN > MAINTAINER > DEVELOPER > VIEWER", () => {
        expect(PermissionHelper.compareRoles(OrgRoles.ADMIN, OrgRoles.MAINTAINER)).toBe(1);
        expect(PermissionHelper.compareRoles(OrgRoles.MAINTAINER, OrgRoles.DEVELOPER)).toBe(1);
        expect(PermissionHelper.compareRoles(OrgRoles.DEVELOPER, OrgRoles.VIEWER)).toBe(1);
        expect(PermissionHelper.compareRoles(OrgRoles.ADMIN, OrgRoles.VIEWER)).toBe(1);

        expect(PermissionHelper.compareRoles(OrgRoles.VIEWER, OrgRoles.DEVELOPER)).toBe(-1);
        expect(PermissionHelper.compareRoles(OrgRoles.DEVELOPER, OrgRoles.ADMIN)).toBe(-1);

        expect(PermissionHelper.compareRoles(OrgRoles.ADMIN, OrgRoles.ADMIN)).toBe(0);
        expect(PermissionHelper.compareRoles(OrgRoles.VIEWER, OrgRoles.VIEWER)).toBe(0);
    });

    test("null is the lowest rank", () => {
        expect(PermissionHelper.compareRoles(null, OrgRoles.VIEWER)).toBe(-1);
        expect(PermissionHelper.compareRoles(OrgRoles.VIEWER, null)).toBe(1);
        expect(PermissionHelper.compareRoles(null, null)).toBe(0);
    });
});

describe("PermissionHelper.maxRole", () => {
    test("picks the higher of two roles, null-safe", () => {
        expect(PermissionHelper.maxRole(OrgRoles.DEVELOPER, OrgRoles.MAINTAINER)).toBe(OrgRoles.MAINTAINER);
        expect(PermissionHelper.maxRole(OrgRoles.ADMIN, OrgRoles.VIEWER)).toBe(OrgRoles.ADMIN);
        expect(PermissionHelper.maxRole(null, OrgRoles.DEVELOPER)).toBe(OrgRoles.DEVELOPER);
        expect(PermissionHelper.maxRole(OrgRoles.DEVELOPER, null)).toBe(OrgRoles.DEVELOPER);
        expect(PermissionHelper.maxRole(null, null)).toBeNull();
    });
});

describe("PermissionHelper.getEffectiveRole", () => {
    let owner: SeededUser;
    let member: SeededUser;
    let stranger: SeededUser;
    let publisherId: number;
    let packageId: number;

    beforeAll(async () => {
        owner = await seedUser("user");
        member = await seedUser("user");
        stranger = await seedUser("user");

        const publisher = await seedPublisher(owner.id);
        publisherId = publisher.id;

        const pkg = await seedPackage(publisherId);
        packageId = pkg.id;

        await seedMembership(publisherId, member.id, OrgRoles.DEVELOPER);
    });

    test("returns the publisher-level role when no package assignment exists", async () => {
        const role = await PermissionHelper.getEffectiveRole({
            userId: member.id,
            publisherId,
        });
        expect(role).toBe(OrgRoles.DEVELOPER);
    });

    test("package-level assignment elevates role above publisher-level", async () => {
        await seedPackageRoleAssignment(packageId, member.id, OrgRoles.MAINTAINER);

        const withoutPackage = await PermissionHelper.getEffectiveRole({
            userId: member.id,
            publisherId,
        });
        expect(withoutPackage).toBe(OrgRoles.DEVELOPER);

        const withPackage = await PermissionHelper.getEffectiveRole({
            userId: member.id,
            publisherId,
            packageId,
        });
        expect(withPackage).toBe(OrgRoles.MAINTAINER);
    });

    test("returns null for users with no relationship", async () => {
        const role = await PermissionHelper.getEffectiveRole({
            userId: stranger.id,
            publisherId,
        });
        expect(role).toBeNull();
    });
});

describe("PermissionHelper.getEffectivePermissions", () => {
    let owner: SeededUser;
    let dev: SeededUser;
    let publisherId: number;

    beforeAll(async () => {
        owner = await seedUser("user");
        dev = await seedUser("user");
        const publisher = await seedPublisher(owner.id);
        publisherId = publisher.id;
        await seedMembership(publisherId, dev.id, OrgRoles.DEVELOPER);
    });

    test("returns the role's permission bag", async () => {
        const perms = await PermissionHelper.getEffectivePermissions({
            userId: dev.id,
            publisherId,
        });
        expect(perms).not.toBeNull();
        expect(perms!.packages.create).toBe(true);
        expect(perms!.packages.delete).toBe(false);
        expect(perms!.members.invite).toBe(false);
    });

    test("returns null when the user has no role", async () => {
        const stranger = await seedUser("user");
        const perms = await PermissionHelper.getEffectivePermissions({
            userId: stranger.id,
            publisherId,
        });
        expect(perms).toBeNull();
    });
});

describe("PermissionHelper.isPublisherOwner", () => {
    test("matches the publisher's owner_user_id", async () => {
        const owner = await seedUser("user");
        const other = await seedUser("user");
        const publisher = await seedPublisher(owner.id);

        expect(await PermissionHelper.isPublisherOwner({ userId: owner.id, publisherId: publisher.id })).toBe(true);
        expect(await PermissionHelper.isPublisherOwner({ userId: other.id, publisherId: publisher.id })).toBe(false);
    });
});

describe("PermissionHelper.can", () => {
    let owner: SeededUser;
    let viewer: SeededUser;
    let developer: SeededUser;
    let siteAdmin: SeededUser;
    let stranger: SeededUser;
    let publisherId: number;
    let packageId: number;

    beforeAll(async () => {
        owner = await seedUser("user");
        viewer = await seedUser("user");
        developer = await seedUser("user");
        siteAdmin = await seedUser("admin");
        stranger = await seedUser("user");

        const publisher = await seedPublisher(owner.id);
        publisherId = publisher.id;
        packageId = (await seedPackage(publisherId)).id;

        await seedMembership(publisherId, viewer.id, OrgRoles.VIEWER);
        await seedMembership(publisherId, developer.id, OrgRoles.DEVELOPER);
    });

    test("unauthenticated → false", async () => {
        const authContext: AuthCtx = { type: "unauthenticated" };
        const allowed = await PermissionHelper.can({
            authContext,
            publisherId,
            check: (p) => p.publisher.update,
        });
        expect(allowed).toBe(false);
    });

    test("site admin → true even without membership", async () => {
        const allowed = await PermissionHelper.can({
            authContext: fakeAuth(siteAdmin),
            publisherId,
            check: (p) => p.packages.delete,
        });
        expect(allowed).toBe(true);
    });

    test("publisher owner → true even for bits their role wouldn't grant", async () => {
        const allowed = await PermissionHelper.can({
            authContext: fakeAuth(owner),
            publisherId,
            check: (p) => p.publisher.delete, // `delete` is false on ADMIN, but owner bypass wins
        });
        expect(allowed).toBe(true);
    });

    test("stranger (no membership) → false", async () => {
        const allowed = await PermissionHelper.can({
            authContext: fakeAuth(stranger),
            publisherId,
            check: (p) => p.packages.create,
        });
        expect(allowed).toBe(false);
    });

    test("DEVELOPER can create packages but cannot delete them", async () => {
        const canCreate = await PermissionHelper.can({
            authContext: fakeAuth(developer),
            publisherId,
            check: (p) => p.packages.create,
        });
        const canDelete = await PermissionHelper.can({
            authContext: fakeAuth(developer),
            publisherId,
            check: (p) => p.packages.delete,
        });
        expect(canCreate).toBe(true);
        expect(canDelete).toBe(false);
    });

    test("VIEWER cannot publish releases", async () => {
        const allowed = await PermissionHelper.can({
            authContext: fakeAuth(viewer),
            publisherId,
            check: (p) => p.packages.releases.publish,
        });
        expect(allowed).toBe(false);
    });

    test("package-level MAINTAINER override elevates DEVELOPER for that package only", async () => {
        const secondPkg = await seedPackage(publisherId);
        await seedPackageRoleAssignment(packageId, developer.id, OrgRoles.MAINTAINER);

        const canUpdateOverriddenPkg = await PermissionHelper.can({
            authContext: fakeAuth(developer),
            publisherId,
            packageId,
            check: (p) => p.packages.update,
        });
        expect(canUpdateOverriddenPkg).toBe(true);

        const canUpdateSiblingPkg = await PermissionHelper.can({
            authContext: fakeAuth(developer),
            publisherId,
            packageId: secondPkg.id,
            check: (p) => p.packages.update,
        });
        expect(canUpdateSiblingPkg).toBe(false);
    });
});
