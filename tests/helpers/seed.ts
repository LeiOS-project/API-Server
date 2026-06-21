import { randomUUID } from "crypto";
import { DB } from "../../src/db";
import { SessionHandler } from "../../src/api/utils/authHandler";
import { PermissionHelper } from "../../src/utils/permission-helper";

export type SeededUser = Omit<DB.Models.User, "password_hash"> & { password: string };

const DEFAULT_PASSWORD = "TestP@ssw0rd";

export async function seedUser(
    role: DB.Models.User["role"] = "user",
    overrides: Partial<DB.Models.User> = {},
    password: string = DEFAULT_PASSWORD
): Promise<SeededUser> {
    const user = DB.instance().insert(DB.Tables.users).values({
        username: overrides.username ?? `user_${randomUUID().slice(0, 8)}`,
        display_name: overrides.display_name ?? "Test User",
        email: overrides.email ?? `${randomUUID()}@example.com`,
        password_hash: await Bun.password.hash(password),
        role,
    } as any).returning().get();

    return { ...user, password };
}

export async function seedSession(user_id: number): Promise<string> {
    const session = await SessionHandler.createSession(user_id);
    return session.token;
}

export async function seedPublisher(
    ownerUserId: number,
    overrides: Partial<DB.Models.Publisher> = {}
): Promise<DB.Models.Publisher> {
    const name = overrides.name ?? `pub-${randomUUID().slice(0, 8)}`;
    const publisher = DB.instance().insert(DB.Tables.publishers).values({
        name,
        display_name: overrides.display_name ?? `Publisher ${name}`,
        description: overrides.description ?? "Seeded publisher",
        homepage_url: overrides.homepage_url ?? `https://${name}.example.com`,
        owner_user_id: ownerUserId,
    }).returning().get();

    // Owner always gets an ADMIN membership — mirrors the create-publisher flow.
    await seedMembership(publisher.id, ownerUserId, PermissionHelper.OrgRoles.ADMIN, false);

    return publisher;
}

export async function seedMembership(
    publisherId: number,
    userId: number,
    role: PermissionHelper.OrgRoles,
    isPubliclyHidden = false
): Promise<DB.Models.PublisherMember> {
    return DB.instance().insert(DB.Tables.publisherMembers).values({
        publisher_id: publisherId,
        user_id: userId,
        role,
        is_publicly_hidden: isPubliclyHidden,
    }).returning().get();
}

export async function seedPackage(
    publisherId: number,
    overrides: Partial<DB.Models.Package> = {}
): Promise<DB.Models.Package> {
    const name = overrides.name ?? `pkg-${randomUUID().slice(0, 8)}`;
    return DB.instance().insert(DB.Tables.packages).values({
        publisher_id: publisherId,
        name,
        display_name: overrides.display_name ?? `Package ${name}`,
        description: overrides.description ?? "Seeded package",
        homepage_url: overrides.homepage_url ?? `https://${name}.example.com`,
        requires_patching: overrides.requires_patching ?? false,
    }).returning().get();
}

export async function seedPackageRoleAssignment(
    packageId: number,
    userId: number,
    role: PermissionHelper.OrgRoles
): Promise<DB.Models.RoleAssignment> {
    return DB.instance().insert(DB.Tables.roleAssignments).values({
        package_id: packageId,
        user_id: userId,
        role,
    }).returning().get();
}

export async function seedPackageRelease(
    packageId: number,
    overrides: Partial<DB.Models.PackageRelease> = {}
): Promise<DB.Models.PackageRelease> {
    return DB.instance().insert(DB.Tables.packageReleases).values({
        package_id: packageId,
        version_with_leios_patch: overrides.version_with_leios_patch ?? "1.0.0",
        changelog: overrides.changelog ?? "Seeded release",
        architectures: overrides.architectures ?? {
            amd64: false,
            arm64: false,
            is_all: false,
        },
    }).returning().get();
}
