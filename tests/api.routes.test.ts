import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { API } from "../src/api";
import { DB } from "../src/db";
import { SessionHandler } from "../src/api/utils/authHandler";
import { AptlyAPI } from "../src/aptly/api";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { mkdirSync, unlinkSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

const TEST_DB_PATH = "./data/test-api.sqlite";

type Repo = AptlyAPI.Utils.Repos;
type Arch = AptlyAPI.Utils.Architectures;

type RepoStore = Record<string, Partial<Record<Arch, AptlyAPI.Packages.Models.PackageInfo>>>;
type PackageStore = Record<Repo, Record<string, RepoStore>>;

const aptStore = new Map<string, PackageStore>();

const originalAptlyPackages = { ...AptlyAPI.Packages } as Record<string, any>;
const originalAptlyDBCleanup = AptlyAPI.DB.cleanup;

let app: any;

function ensurePackage(name: string): PackageStore {
    if (!aptStore.has(name)) {
        aptStore.set(name, {
            "leios-archive": {},
            "leios-testing": {},
            "leios-stable": {}
        });
    }
    return aptStore.get(name)!;
}

function recordRelease(repo: Repo, name: string, version: string, arch: Arch, leios_patch?: string | null) {
    const pkgInfo: AptlyAPI.Packages.Models.PackageInfo = {
        name,
        key: `${name}-${version}-${arch}`,
        version,
        leios_patch: leios_patch ?? undefined,
        architecture: arch,
        maintainer: "Test Maintainer <maintainer@example.com>",
        description: `${name} ${version}`
    };

    const repoStore = ensurePackage(name)[repo];
    if (!repoStore[version]) {
        repoStore[version] = {};
    }
    repoStore[version][arch] = pkgInfo;
}

function resetAptStore() {
    aptStore.clear();
}

function mockAptlyApi() {
    (AptlyAPI.DB as any).cleanup = async () => true;

    (AptlyAPI.Packages as any).uploadAndVerify = async (
        repo: Repo,
        data: {
            name: string;
            maintainer_name: string;
            maintainer_email: string;
            version: string;
            leios_patch?: string;
            architecture: Arch;
        }
    ) => {
        recordRelease(repo, data.name, data.version, data.architecture, data.leios_patch ?? null);
        return true;
    };

    (AptlyAPI.Packages as any).copyIntoRepo = async (
        targetRepo: Repo,
        packageName: string,
        version: string,
        leios_patch: string | undefined,
        packageArch: Arch
    ) => {
        recordRelease(targetRepo, packageName, version, packageArch, leios_patch ?? null);
        return true;
    };

    (AptlyAPI.Packages as any).deleteInRepo = async (
        repoName: Repo,
        packageName: string,
        packageVersion?: string,
        leios_patch?: string,
        packageArch?: Arch
    ) => {
        const pkg = aptStore.get(packageName);
        if (!pkg) return true;

        const repoData = pkg[repoName];
        if (packageVersion) {
            const versions = repoData[packageVersion];
            if (versions && packageArch) {
                delete versions[packageArch];
            }
            if (!packageArch) {
                delete repoData[packageVersion];
            }
        } else {
            Object.keys(repoData).forEach((ver) => delete repoData[ver]);
        }
        return true;
    };

    (AptlyAPI.Packages as any).deleteAllInAllRepos = async (
        packageName: string,
        packageVersion?: string,
        leios_patch?: string,
        packageArch?: Arch
    ) => {
        for (const repo of AptlyAPI.Utils.REPOS) {
            await (AptlyAPI.Packages as any).deleteInRepo(repo, packageName, packageVersion, leios_patch, packageArch);
        }
        return true;
    };

    (AptlyAPI.Packages as any).getAllInRepo = async (repoName: Repo, packageName: string) => {
        const pkg = ensurePackage(packageName);
        return pkg[repoName];
    };

    (AptlyAPI.Packages as any).getAllInAllRepos = async (packageName: string) => {
        const pkg = ensurePackage(packageName);
        return pkg;
    };

    (AptlyAPI.Packages as any).getRefInRepo = async (
        repoName: Repo,
        packageName: string,
        packageVersion?: string,
        _leios_patch?: string,
        packageArch?: Arch
    ) => {
        const pkg = ensurePackage(packageName)[repoName];
        const refs: string[] = [];
        const versions = packageVersion ? { [packageVersion]: pkg[packageVersion] } : pkg;
        Object.values(versions).forEach((entry) => {
            if (!entry) return;
            if (packageArch) {
                const release = entry[packageArch];
                if (release) refs.push(release.key);
            } else {
                Object.values(entry).forEach((release) => release && refs.push(release.key));
            }
        });
        return refs;
    };

    (AptlyAPI.Packages as any).getInRepo = async (
        repoName: Repo,
        packageName: string,
        packageVersion?: string,
        _leios_patch?: string,
        packageArch?: Arch
    ) => {
        const pkg = ensurePackage(packageName)[repoName];
        const versions = packageVersion ? { [packageVersion]: pkg[packageVersion] } : pkg;
        const releases: AptlyAPI.Packages.Models.PackageInfo[] = [];
        Object.values(versions).forEach((entry) => {
            if (!entry) return;
            const architectures = packageArch ? { [packageArch]: entry[packageArch] } : entry;
            Object.values(architectures).forEach((release) => release && releases.push(release));
        });
        return releases;
    };

    (AptlyAPI.Packages as any).existsInRepo = async (
        repoName: Repo,
        packageName: string,
        packageVersion?: string,
        leios_patch?: string,
        packageArch?: Arch
    ) => {
        const refs = await (AptlyAPI.Packages as any).getRefInRepo(repoName, packageName, packageVersion, leios_patch, packageArch);
        return refs.length > 0;
    };
}

function restoreAptlyApi() {
    Object.assign(AptlyAPI.Packages as any, originalAptlyPackages);
    (AptlyAPI.DB as any).cleanup = originalAptlyDBCleanup;
}

async function resetDatabase() {
    await DB.instance().delete(DB.Schema.stablePromotionRequests).run();
    await DB.instance().delete(DB.Schema.packageReleases).run();
    await DB.instance().delete(DB.Schema.packages).run();
    await DB.instance().delete(DB.Schema.apiKeys).run();
    await DB.instance().delete(DB.Schema.sessions).run();
    await DB.instance().delete(DB.Schema.passwordResets).run();
    await DB.instance().delete(DB.Schema.users).run();
}

async function seedUser(role: "admin" | "developer" | "user", overrides: Partial<DB.Models.User> = {}, password = "TestP@ssw0rd") {
    const user = DB.instance().insert(DB.Schema.users).values({
        username: overrides.username ?? `user_${randomUUID().slice(0, 8)}`,
        display_name: overrides.display_name ?? "Test User",
        email: overrides.email ?? `${randomUUID()}@example.com`,
        password_hash: await Bun.password.hash(password),
        role,
    } as any).returning().get();

    return { user, password };
}

async function seedPackage(ownerId: number, overrides: Partial<DB.Models.Package> = {}) {
    return DB.instance().insert(DB.Schema.packages).values({
        name: overrides.name ?? `pkg-${randomUUID()}`,
        owner_user_id: ownerId,
        description: overrides.description ?? "A useful package",
        homepage_url: overrides.homepage_url ?? "https://example.com",
        requires_patching: overrides.requires_patching ?? false
    }).returning().get();
}

async function seedRelease(packageId: number, version = "1.0.0", arch: Arch = "amd64", leios_patch: string | null = null) {
    return DB.instance().insert(DB.Schema.packageReleases).values({
        package_id: packageId,
        version,
        leios_patch,
        architecture: arch,
    }).returning().get();
}

function authHeaders(token: string) {
    return {
        Authorization: `Bearer ${token}`
    };
}

beforeAll(async () => {
    if (!existsSync("./data")) {
        mkdirSync("./data");
    }
    if (existsSync(TEST_DB_PATH)) {
        unlinkSync(TEST_DB_PATH);
    }

    const sqlite = new Database(TEST_DB_PATH);
    const drizzleDb = drizzle(sqlite);
    await migrate(drizzleDb, { migrationsFolder: "drizzle" });
    // @ts-ignore - inject test database directly
    DB["db"] = drizzleDb;

    mockAptlyApi();
    await API.init();
    app = (API as any).app;
});

afterEach(async () => {
    await resetDatabase();
    resetAptStore();
});

afterAll(async () => {
    restoreAptlyApi();
    if (existsSync(TEST_DB_PATH)) {
        unlinkSync(TEST_DB_PATH);
    }
});

describe("Auth routes", () => {
    test("POST /auth/login authenticates and creates session", async () => {
        const { user, password } = await seedUser("user");

        const res = await app.request("/auth/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ username: user.username, password })
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data.token.startsWith("lra_sess_")).toBe(true);

        const stored = DB.instance().select().from(DB.Schema.sessions).where(eq(DB.Schema.sessions.token, body.data.token as string)).get();
        expect(stored?.user_id).toBe(user.id);
    });

    test("POST /auth/logout invalidates session", async () => {
        const { user } = await seedUser("user");
        const session = await SessionHandler.createSession(user.id);

        const res = await app.request("/auth/logout", {
            method: "POST",
            headers: authHeaders(session.token)
        });

        expect(res.status).toBe(200);
        const check = DB.instance().select().from(DB.Schema.sessions).where(eq(DB.Schema.sessions.token, session.token)).get();
        expect(check).toBeUndefined();
    });
});

describe("Account routes", () => {
    test("GET /account returns current user", async () => {
        const { user } = await seedUser("user");
        const session = await SessionHandler.createSession(user.id);

        const res = await app.request("/account", {
            headers: authHeaders(session.token)
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data.id).toBe(user.id);
        expect(body.data.password_hash).toBeUndefined();
    });

    test("PUT /account updates profile fields", async () => {
        const { user } = await seedUser("user");
        const session = await SessionHandler.createSession(user.id);

        const res = await app.request("/account", {
            method: "PUT",
            headers: {
                ...authHeaders(session.token),
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ display_name: "Updated", username: user.username })
        });

        expect(res.status).toBe(200);
        const updated = DB.instance().select().from(DB.Schema.users).where(eq(DB.Schema.users.id, user.id)).get();
        expect(updated?.display_name).toBe("Updated");
    });

    test("PUT /account/password rotates credentials and invalidates old sessions", async () => {
        const oldPassword = "OldP@ssw0rd";
        const { user } = await seedUser("user", {}, oldPassword);
        const session = await SessionHandler.createSession(user.id);

        const res = await app.request("/account/password", {
            method: "PUT",
            headers: {
                ...authHeaders(session.token),
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ current_password: oldPassword, new_password: "NewP@ssw0rd1" })
        });

        expect(res.status).toBe(200);
        const stillThere = DB.instance().select().from(DB.Schema.sessions).where(eq(DB.Schema.sessions.token, session.token)).get();
        expect(stillThere).toBeUndefined();

        const loginRes = await app.request("/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: user.username, password: "NewP@ssw0rd1" })
        });
        expect(loginRes.status).toBe(200);
    });

    test("DELETE /account prevents removal while packages exist", async () => {
        const { user } = await seedUser("user");
        const session = await SessionHandler.createSession(user.id);
        await seedPackage(user.id);

        const res = await app.request("/account", {
            method: "DELETE",
            headers: authHeaders(session.token)
        });

        expect(res.status).toBe(400);
    });
});

describe("Public package routes", () => {
    test("Lists packages and returns details with releases", async () => {
        const { user } = await seedUser("developer");
        const pkg = await seedPackage(user.id, { name: "public-pkg" });
        recordRelease("leios-archive", pkg.name, "1.0.0", "amd64");

        const listRes = await app.request("/public/packages");
        expect(listRes.status).toBe(200);
        const listBody = await listRes.json();
        expect(Array.isArray(listBody.data)).toBe(true);
        expect(listBody.data[0].name).toBe(pkg.name);

        const detailRes = await app.request(`/public/packages/${pkg.name}`);
        expect(detailRes.status).toBe(200);
        const detailBody = await detailRes.json();
        expect(detailBody.data.package.name).toBe(pkg.name);
        expect(detailBody.data.releases["leios-archive"]["1.0.0"].amd64.name).toBe(pkg.name);
    });
});

describe("Developer package routes", () => {
    test("Developer can create and update own package", async () => {
        const { user } = await seedUser("developer");
        const session = await SessionHandler.createSession(user.id);

        const createRes = await app.request("/dev/packages", {
            method: "POST",
            headers: {
                ...authHeaders(session.token),
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                name: "devpkg",
                description: "Dev package",
                homepage_url: "https://devpkg.example.com",
                requires_patching: false
            })
        });

        expect(createRes.status).toBe(201);
        const createdBody = await createRes.json();

        const pkg = DB.instance().select().from(DB.Schema.packages).where(eq(DB.Schema.packages.id, createdBody.data.id)).get();
        expect(pkg?.owner_user_id).toBe(user.id);

        const updateRes = await app.request(`/dev/packages/${createdBody.data.id}`, {
            method: "PUT",
            headers: {
                ...authHeaders(session.token),
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ description: "Updated description" })
        });
        const updateBody = await updateRes.json();
        expect(updateRes.status).toBe(200);
        expect(updateBody.message).toBe("Package updated successfully");
        const updated = DB.instance().select().from(DB.Schema.packages).where(eq(DB.Schema.packages.id, createdBody.data.id)).get();
        expect(updated?.description).toBe("Updated description");
    });

    test("Developer release lifecycle stores data", async () => {
        const { user } = await seedUser("developer");
        const session = await SessionHandler.createSession(user.id);
        const pkg = await seedPackage(user.id, { name: "release-pkg" });

        const listBefore = await app.request(`/dev/packages/${pkg.id}/releases`, {
            headers: authHeaders(session.token)
        });
        const emptyBody = await listBefore.json();
        expect(listBefore.status).toBe(200);
        expect(emptyBody.data).toEqual([]);

        const file = new File(["content"], "pkg.deb");
        const form = new FormData();
        form.set("file", file);

        const createRes = await app.request(`/dev/packages/${pkg.id}/releases/1.2.3/amd64`, {
            method: "POST",
            headers: authHeaders(session.token),
            body: form
        });
        const createBody = await createRes.json();
        expect(createRes.status).toBe(201);
        expect(createBody.message).toBe("Package release created successfully");

        const dbRelease = DB.instance().select().from(DB.Schema.packageReleases).where(eq(DB.Schema.packageReleases.package_id, pkg.id)).get();
        expect(dbRelease?.version).toBe("1.2.3");

        const listAfter = await app.request(`/dev/packages/${pkg.id}/releases`, {
            headers: authHeaders(session.token)
        });
        expect(listAfter.status).toBe(200);
        const afterBody = await listAfter.json();
        expect(afterBody.data.length).toBe(1);
    });

    test("Developer can request stable promotion", async () => {
        const { user } = await seedUser("developer");
        const session = await SessionHandler.createSession(user.id);
        const pkg = await seedPackage(user.id, { name: "stable-pkg" });
        const release = await seedRelease(pkg.id, "2.0.0", "arm64");

        const createRes = await app.request(`/dev/packages/${pkg.id}/stable-promotion-requests`, {
            method: "POST",
            headers: {
                ...authHeaders(session.token),
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ package_release_id: release.id })
        });
        const createBody = await createRes.json();
        expect(createRes.status).toBe(201);
        expect(createBody.message).toBe("Stable promotion request submitted");

        const listRes = await app.request(`/dev/packages/${pkg.id}/stable-promotion-requests`, {
            headers: authHeaders(session.token)
        });
        expect(listRes.status).toBe(200);
        const body = await listRes.json();
        expect(body.data[0].package_release_id).toBe(release.id);
    });
});

describe("Admin routes", () => {
    test("Admin can create and delete packages", async () => {
        const { user: admin } = await seedUser("admin");
        const { user: developer } = await seedUser("developer");
        const adminSession = await SessionHandler.createSession(admin.id);

        const createRes = await app.request("/admin/packages", {
            method: "POST",
            headers: {
                ...authHeaders(adminSession.token),
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                name: "admin-pkg",
                owner_user_id: developer.id,
                description: "Admin created",
                homepage_url: "https://adminpkg.example.com",
                requires_patching: false
            })
        });
        expect(createRes.status).toBe(201);
        const createdBody = await createRes.json();

        const deleteRes = await app.request(`/admin/packages/${createdBody.data.id}`, {
            method: "DELETE",
            headers: authHeaders(adminSession.token)
        });
        const deleteBody = await deleteRes.json();
        expect(deleteRes.status).toBe(200);
        expect(deleteBody.message).toBe("Package deleted successfully");
        const pkg = DB.instance().select().from(DB.Schema.packages).where(eq(DB.Schema.packages.id, createdBody.data.id)).get();
        expect(pkg).toBeUndefined();
    });

    test("Admin user management CRUD", async () => {
        const { user: admin } = await seedUser("admin");
        const adminSession = await SessionHandler.createSession(admin.id);

        const createRes = await app.request("/admin/users", {
            method: "POST",
            headers: {
                ...authHeaders(adminSession.token),
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: "managed",
                display_name: "Managed User",
                email: "managed@example.com",
                password: "Adm1nManage!",
                role: "user"
            })
        });
        expect(createRes.status).toBe(201);
        const created = await createRes.json();

        const updateRes = await app.request(`/admin/users/${created.data.id}`, {
            method: "PUT",
            headers: {
                ...authHeaders(adminSession.token),
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ display_name: "Renamed", role: "developer" })
        });
        const updateBody = await updateRes.json();
        expect(updateRes.status).toBe(200);
        expect(updateBody.message).toBe("User updated successfully");

        const passwordRes = await app.request(`/admin/users/${created.data.id}/password`, {
            method: "PUT",
            headers: {
                ...authHeaders(adminSession.token),
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ password: "N3wAdm1nPw" })
        });
        expect(passwordRes.status).toBe(200);

        const deleteRes = await app.request(`/admin/users/${created.data.id}`, {
            method: "DELETE",
            headers: authHeaders(adminSession.token)
        });
        expect(deleteRes.status).toBe(200);
        const deleted = DB.instance().select().from(DB.Schema.users).where(eq(DB.Schema.users.id, created.data.id)).get();
        expect(deleted).toBeUndefined();
    });
});
