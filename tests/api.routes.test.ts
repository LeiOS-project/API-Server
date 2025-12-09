import { describe, expect, test } from "bun:test";
import { API } from "../src/api";
import { DB } from "../src/db";
import { AuthHandler, SessionHandler } from "../src/api/utils/authHandler";
import { AptlyAPI } from "../src/aptly/api";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { AuthModel } from "../src/api/routes/auth/model";
import { makeAPIRequest } from "./helpers/api";
import { AccountModel } from "../src/api/routes/account/model";

const PACKAGE_FILE_PATH = "./testdata/fastfetch_2.55.0_amd64.deb";
const PACKAGE_NAME = "fastfetch";
const PACKAGE_VERSION = "2.55.0";
const PACKAGE_ARCH: Arch = "amd64";
const PACKAGE_MAINTAINER_NAME = "Carter Li";
const PACKAGE_MAINTAINER_EMAIL = "zhangsongcui@live.cn";

type Arch = AptlyAPI.Utils.Architectures;

async function seedUser(role: "admin" | "developer" | "user", overrides: Partial<DB.Models.User> = {}, password = "TestP@ssw0rd") {
    const user = DB.instance().insert(DB.Schema.users).values({
        username: overrides.username ?? `user_${randomUUID().slice(0, 8)}`,
        display_name: overrides.display_name ?? "Test User",
        email: overrides.email ?? `${randomUUID()}@example.com`,
        password_hash: await Bun.password.hash(password),
        role,
    } as any).returning().get();

    return { ...user, password } as Omit<typeof user & { password: string }, "password_hash">;
}

async function seedSession(user_id: number) {
    const session = await SessionHandler.createSession(user_id);
    return session;
    
}

const testAdmin = await seedUser("admin", { username: "testadmin" }, "AdminP@ss1");
const testDeveloper = await seedUser("developer", { username: "testdeveloper" }, "DevP@ss1");
const testUser = await seedUser("user", { username: "testuser" }, "UserP@ss1");

describe("Auth routes and access checks", async () => {

    let session_token: string;

    test("POST /auth/login authenticates and creates session", async () => {

        const data = await makeAPIRequest("/auth/login", {
            method: "POST",
            body: { username: testUser.username, password: testUser.password },
            expectedBodySchema: AuthModel.Login.Response
        });

        expect(data.token.startsWith("lra_sess_")).toBe(true);
        
        session_token = data.token;

        const session = await AuthHandler.getAuthContext(data.token);

        expect(session).toBeDefined();
        if (!session) return;

        expect(session.user_id).toBe(testUser.id);
        expect(session.user_role).toBe("user");
        expect(session.type).toBe("session");
        expect(session.token).toBe(data.token);
    });

    test("POST /auth/login with invalid credentials fails", async () => {

        await makeAPIRequest("/auth/login", {
            method: "POST",
            body: { username: testUser.username, password: "WrongPassword" },
        }, 401);

    });

    test("GET /auth/session returns current session info", async () => {

        const data = await makeAPIRequest("/auth/session", {
            authToken: session_token,
            expectedBodySchema: AuthModel.Session.Response
        });

        expect(data.user_id).toBe(testUser.id);
        expect(data.user_role).toBe("user");
        expect(data.token).toBe(session_token);
    });

    test("GET /auth/session with invalid token fails", async () => {

        await makeAPIRequest("/auth/session", {
            authToken: "invalid_token",
        }, 401);

    });
    
    test("GET /dev as admin succeeds", async () => {

        await makeAPIRequest("/dev", {
            authToken: session_token,
        }, 401);

    });

    test("GET /admin as non-admin fails", async () => {

        await makeAPIRequest("/admin", {
            authToken: session_token,
        }, 401);

    });

    test("POST /auth/logout invalidates session", async () => {

        await makeAPIRequest("/auth/logout", {
            method: "POST",
            authToken: session_token
        });

        const session = await AuthHandler.getAuthContext(session_token);

        expect(session).toBeNil();
    });
});

describe("Account routes", async () => {

    const session_token = await seedSession(testUser.id).then(s => s.token);

    test("GET /account returns current user", async () => {

        const data = await makeAPIRequest("/account", {
            authToken: session_token,
            expectedBodySchema: AccountModel.GetInfo.Response
        });

        expect(data.id).toBe(testUser.id);
        expect(data.username).toBe(testUser.username);
        expect(data.display_name).toBe(testUser.display_name);
        expect(data.email).toBe(testUser.email);
        expect(data.role).toBe("user");
    });

    test("PUT /account updates profile fields", async () => {
        
        const newUserData = {
            display_name: "Updated Name",
            username: "updatedusername",
            email: "updated@example.com"
        }

        await makeAPIRequest("/account", {
            method: "PUT",
            authToken: session_token,
            body: newUserData
        });

        const dbresult = DB.instance().select().from(DB.Schema.users).where(eq(DB.Schema.users.id, testUser.id)).get();

        expect(dbresult?.display_name).toBe(newUserData.display_name);
        expect(dbresult?.username).toBe(newUserData.username);
        expect(dbresult?.email).toBe(newUserData.email);
    });

    test("PUT /account try updating role fails", async () => {
        
        await makeAPIRequest("/account", {
            method: "PUT",
            authToken: session_token,
            body: { role: "admin" }
        }, 500);
        
        const dbresult = DB.instance().select().from(DB.Schema.users).where(eq(DB.Schema.users.id, testUser.id)).get();
        expect(dbresult?.role).toBe("user");
    });

    test("PUT /account/password rotates credentials and invalidates old sessions", async () => {
        const oldPassword = "OldP@ssw0rd";
        const { user } = await seedUser("user", {}, oldPassword);
        const session = await SessionHandler.createSession(user.id);

        const res = await API.getApp().request("/account/password", {
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

        const loginRes = await API.getApp().request("/auth/login", {
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

        const res = await API.getApp().request("/account", {
            method: "DELETE",
            headers: authHeaders(session.token)
        });

        expect(res.status).toBe(400);
    });
});

describe("Public package routes", () => {
    test("Lists packages and returns details with releases", async () => {
        const { user } = await seedUser("developer");
        const pkg = await seedPackage(user.id, { name: PACKAGE_NAME });

        // await uploadFixtureToArchive();

        const listRes = await API.getApp().request("/public/packages");
        expect(listRes.status).toBe(200);
        const listBody = await listRes.json();
        expect(Array.isArray(listBody.data)).toBe(true);
        expect(listBody.data[0].name).toBe(pkg.name);

        const detailRes = await API.getApp().request(`/public/packages/${pkg.name}`);
        expect(detailRes.status).toBe(200);
        const detailBody = await detailRes.json();
        expect(detailBody.data.package.name).toBe(pkg.name);
        expect(detailBody.data.releases["leios-archive"][PACKAGE_VERSION].amd64.name).toBe(pkg.name);
    });
});

describe("Developer package routes", () => {
    test("Developer can create and update own package", async () => {
        const { user } = await seedUser("developer");
        const session = await SessionHandler.createSession(user.id);

        const createRes = await API.getApp().request("/dev/packages", {
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

        const updateRes = await API.getApp().request(`/dev/packages/${createdBody.data.id}`, {
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
        const { user } = await seedUser("developer", {
            display_name: PACKAGE_MAINTAINER_NAME,
            email: PACKAGE_MAINTAINER_EMAIL
        });
        const session = await SessionHandler.createSession(user.id);
        const pkg = await seedPackage(user.id, { name: PACKAGE_NAME });

        const listBefore = await API.getApp().request(`/dev/packages/${pkg.id}/releases`, {
            headers: authHeaders(session.token)
        });
        const emptyBody = await listBefore.json();
        expect(listBefore.status).toBe(200);
        expect(emptyBody.data).toEqual([]);

        const file = new File([await Bun.file(PACKAGE_FILE_PATH).arrayBuffer()], "package.deb");
        const form = new FormData();
        form.set("file", file);

        const createRes = await API.getApp().request(`/dev/packages/${pkg.id}/releases/${PACKAGE_VERSION}/${PACKAGE_ARCH}`, {
            method: "POST",
            headers: authHeaders(session.token),
            body: form
        });
        const createBody = await createRes.json();
        expect(createRes.status).toBe(201);
        expect(createBody.message).toBe("Package release created successfully");


        const dbRelease = DB.instance().select().from(DB.Schema.packageReleases).where(eq(DB.Schema.packageReleases.package_id, pkg.id)).get();
        expect(dbRelease?.version).toBe(PACKAGE_VERSION);

        const listAfter = await API.getApp().request(`/dev/packages/${pkg.id}/releases`, {
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

        const createRes = await API.getApp().request(`/dev/packages/${pkg.id}/stable-promotion-requests`, {
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

        const listRes = await API.getApp().request(`/dev/packages/${pkg.id}/stable-promotion-requests`, {
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

        const createRes = await API.getApp().request("/admin/packages", {
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

        const deleteRes = await API.getApp().request(`/admin/packages/${createdBody.data.id}`, {
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

        const createRes = await API.getApp().request("/admin/users", {
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

        const updateRes = await API.getApp().request(`/admin/users/${created.data.id}`, {
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

        const passwordRes = await API.getApp().request(`/admin/users/${created.data.id}/password`, {
            method: "PUT",
            headers: {
                ...authHeaders(adminSession.token),
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ password: "N3wAdm1nPw" })
        });
        expect(passwordRes.status).toBe(200);

        const deleteRes = await API.getApp().request(`/admin/users/${created.data.id}`, {
            method: "DELETE",
            headers: authHeaders(adminSession.token)
        });
        expect(deleteRes.status).toBe(200);
        const deleted = DB.instance().select().from(DB.Schema.users).where(eq(DB.Schema.users.id, created.data.id)).get();
        expect(deleted).toBeUndefined();
    });
});
