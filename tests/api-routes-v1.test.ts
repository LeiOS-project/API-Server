import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { API } from "../src/api";
import { DB } from "../src/db";
import { AuthHandler, AuthUtils, SessionHandler } from "../src/api/utils/authHandler";
import { AptlyAPI } from "../src/aptly/api";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { AuthModel } from "../src/api/versions/v1/routes/auth/model";
import { makeAPIRequest } from "./helpers/api";
import { AccountModel } from "../src/api/versions/v1/routes/account/model";
import { PackageModel } from "../src/api/utils/shared-models/package";
import { PermissionHelper } from "../src/utils/permission-helper";

// type Arch = AptlyAPI.Utils.Architectures;

// const PACKAGE_FILE_PATH = "./testdata/fastfetch_2.55.0_amd64.deb";
// const PACKAGE_NAME = "fastfetch";
// const PACKAGE_VERSION = "2.55.0";
// const PACKAGE_ARCH: Arch = "amd64";  
// const PACKAGE_MAINTAINER_NAME = "Carter Li";
// const PACKAGE_MAINTAINER_EMAIL = "zhangsongcui@live.cn";

type SeededUser = Omit<DB.Models.User, "password_hash"> & { password: string };
type SeededSession = Awaited<ReturnType<typeof SessionHandler.createSession>>;

async function seedUser(role: DB.Models.User["role"], overrides: Partial<DB.Models.User> = {}, password = "TestP@ssw0rd") {
    const user = DB.instance().insert(DB.Tables.users).values({
        username: overrides.username ?? `user_${randomUUID().slice(0, 8)}`,
        display_name: overrides.display_name ?? "Test User",
        email: overrides.email ?? `${randomUUID()}@example.com`,
        password_hash: await Bun.password.hash(password),
        role,
    } as any).returning().get();

    return { ...user, password } satisfies SeededUser;
}

async function seedSession(user_id: number) {
    const session = await SessionHandler.createSession(user_id);
    return session satisfies SeededSession;
}

async function seedPublisherWithOwner(ownerUserId: number, overrides: Partial<DB.Models.Publisher> = {}) {
    const name = overrides.name ?? `pub-${randomUUID().slice(0, 8)}`;

    return await DB.instance().insert(DB.Tables.publishers).values({
        name,
        display_name: overrides.display_name ?? `Publisher ${name}`,
        description: overrides.description ?? "Seeded publisher",
        homepage_url: overrides.homepage_url ?? `https://${name}.example.com`,
        owner_user_id: ownerUserId
    }).returning().get();
}

async function seedTask(overrides: Partial<DB.Models.ScheduledTask> = {}) {
    return DB.instance().insert(DB.Tables.scheduled_tasks).values({
        function: overrides.function ?? "test:task",
        created_by_user_id: overrides.created_by_user_id ?? null,
        args: overrides.args ?? {},
        autoDelete: overrides.autoDelete ?? false,
        storeLogs: overrides.storeLogs ?? false,
        status: overrides.status ?? "pending",
        created_at: overrides.created_at ?? Date.now(),
        finished_at: overrides.finished_at,
        result: overrides.result,
        message: overrides.message,
    }).returning().get();
}

let testUser: SeededUser;
let testDeveloper: SeededUser;
let testAdmin: SeededUser;

beforeAll(async () => {
    testUser = await seedUser("user", { username: "testuser" }, "UserP@ss1");
    testDeveloper = await seedUser("developer", { username: "testdeveloper" }, "DevP@ss1");
    testAdmin = await seedUser("admin", { username: "testadmin" }, "AdminP@ss1");
});


describe("Auth routes and access checks", async () => {

    let session_token: string;

    test("POST /auth/login authenticates and creates session", async () => {

        const data = await makeAPIRequest("/v1/auth/login", {
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
        expect(session.expires_at).toBeGreaterThan(Date.now());

        const tokenParts = AuthUtils.getTokenParts(data.token);
        expect(tokenParts).toBeDefined();
        if (!tokenParts) return;
        
        expect(await AuthUtils.verifyHashedTokenBase(tokenParts.base, session.hashed_token)).toBe(true);
        expect(tokenParts.prefix).toBe("lra_sess_");
        expect(tokenParts.id).toBe(session.id);
    });

    test("POST /auth/login with invalid credentials fails", async () => {

        await makeAPIRequest("/v1/auth/login", {
            method: "POST",
            body: { username: testUser.username, password: "WrongPassword" },
        }, 401);

    });

    test("GET /auth/session returns current session info", async () => {

        const data = await makeAPIRequest("/v1/auth/session", {
            authToken: session_token,
            expectedBodySchema: AuthModel.Session.Response
        });

        expect(data.user_id).toBe(testUser.id);
        expect(data.user_role).toBe("user");
    });

    test("GET /auth/session with invalid token fails", async () => {

        await makeAPIRequest("/v1/auth/session", {
            authToken: "invalid_token",
        }, 401);

    });
    
    test("GET /admin/users as non-admin fails", async () => {

        await makeAPIRequest("/v1/admin/users", {
            authToken: session_token,
        }, 403);

    });

    test("POST /auth/logout invalidates session", async () => {

        await makeAPIRequest("/v1/auth/logout", {
            method: "POST",
            authToken: session_token
        });

        const session = await AuthHandler.getAuthContext(session_token);

        expect(session).toBeNil();
    });
});

describe("Account routes", async () => {

    let session_token: string;

    beforeAll(async () => {
        session_token = await seedSession(testUser.id).then(s => s.token);
    });

    test("GET /account returns current user", async () => {

        const data = await makeAPIRequest("/v1/account", {
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

        await makeAPIRequest("/v1/account", {
            method: "PUT",
            authToken: session_token,
            body: newUserData
        });

        testUser.display_name = newUserData.display_name;
        testUser.username = newUserData.username;
        testUser.email = newUserData.email;

        const dbresult = DB.instance().select().from(DB.Tables.users).where(eq(DB.Tables.users.id, testUser.id)).get();

        expect(dbresult?.display_name).toBe(newUserData.display_name);
        expect(dbresult?.username).toBe(newUserData.username);
        expect(dbresult?.email).toBe(newUserData.email);
    });

    test("PUT /account try updating role fails", async () => {
        
        await makeAPIRequest("/v1/account", {
            method: "PUT",
            authToken: session_token,
            body: { role: "admin" }
        }, 400);
        
        const dbresult = DB.instance().select().from(DB.Tables.users).where(eq(DB.Tables.users.id, testUser.id)).get();
        expect(dbresult?.role).toBe("user");
    });

    test("PUT /account/password rotates credentials and invalidates old sessions", async () => {

        const oldPassword = testUser.password;
        const newPassword = "NewP@ssw0rd1";

        await makeAPIRequest("/v1/account/password", {
            method: "PUT",
            authToken: session_token,
            body: {
                current_password: oldPassword,
                new_password: newPassword
            }
        });

        testUser.password = newPassword;

        // Old session should be invalidated
        await makeAPIRequest("/v1/account", {
            authToken: session_token,
        }, 401);

        // Login with old password should fail
        await makeAPIRequest("/v1/auth/login", {
            method: "POST",
            body: { username: testUser.username, password: oldPassword }
        }, 401);

        // Login with new password should succeed
        const data = await makeAPIRequest("/v1/auth/login", {
            method: "POST",
            body: { username: testUser.username, password: newPassword },
            expectedBodySchema: AuthModel.Login.Response
        });

        expect(data.token.startsWith("lra_sess_")).toBe(true);

        session_token = data.token;
    });

    test("DELETE /account prevents removal while publishers are owned", async () => {

        const tempPublisher = await DB.instance().insert(DB.Tables.publishers).values({
            name: "temp-account-pub",
            display_name: "Temp Publisher",
            description: "Temporary publisher",
            homepage_url: "https://temp.example.com",
            owner_user_id: testUser.id
        }).returning().get();

        await makeAPIRequest("/v1/account", {
            method: "DELETE",
            authToken: session_token
        }, 400);

        const dbresult = DB.instance().select().from(DB.Tables.users).where(eq(DB.Tables.users.id, testUser.id)).get();
        expect(dbresult).toBeDefined();

        // Cleanup — blow away the publisher so the next test can delete the user.
        await DB.instance().delete(DB.Tables.publishers).where(eq(DB.Tables.publishers.id, tempPublisher.id));
    });

    test("DELETE /account removes user without packages", async () => {
        
        await makeAPIRequest("/v1/account", {
            method: "DELETE",
            authToken: session_token
        });

        const dbresult = DB.instance().select().from(DB.Tables.users).where(eq(DB.Tables.users.id, testUser.id)).get();
        expect(dbresult).toBeUndefined();

        // recreate test user for further tests
        testUser = await seedUser("user", { username: "testuser" }, "UserP@ss1");
    });
});

describe("Package list route", () => {

    test("GET /packages lists packages", async () => {

        const tempPublisher = await DB.instance().insert(DB.Tables.publishers).values({
            name: "public-pub",
            display_name: "Public Publisher",
            description: "Publisher for public package test",
            homepage_url: "https://public.example.com",
            owner_user_id: testDeveloper.id
        }).returning().get();

        const tempPkg = await DB.instance().insert(DB.Tables.packages).values({
            publisher_id: tempPublisher.id,
            name: "public-package",
            display_name: "Public Package",
            description: "Public package",
            homepage_url: "https://public.example.com",
            requires_patching: false
        }).returning().get();

        const tempRelease = await DB.instance().insert(DB.Tables.packageReleases).values({
            package_id: tempPkg.id,
            version_with_leios_patch: "1.0.0",
            changelog: "Initial release",
            architectures: {
                amd64: true,
                arm64: false,
                is_all: false
            }
        }).returning().get();

        const data = await makeAPIRequest(`/v1/packages?publisherID=${tempPublisher.id}`, {
            expectedBodySchema: PackageModel.GetAll.Response
        });

        expect(data.length).toBe(1);

        const pkg = data[0]!;
        expect(pkg.id).toBe(tempPkg.id);
        expect(pkg.name).toBe(tempPkg.name);
        expect(pkg.fullname).toBe(`${tempPublisher.name}.${tempPkg.name}`);

        // Cleanup
        await DB.instance().delete(DB.Tables.packageReleases).where(eq(DB.Tables.packageReleases.id, tempRelease.id));
        await DB.instance().delete(DB.Tables.packages).where(eq(DB.Tables.packages.id, tempPkg.id));
        await DB.instance().delete(DB.Tables.publishers).where(eq(DB.Tables.publishers.id, tempPublisher.id));
    });
});

// describe("Developer package routes", () => {
//     test("Developer can create and update own package", async () => {
//         const { user } = await seedUser("developer");
//         const session = await SessionHandler.createSession(user.id);

//         const createRes = await API.getApp().request("/dev/packages", {
//             method: "POST",
//             headers: {
//                 ...authHeaders(session.token),
//                 "Content-Type": "application/json"
//             },
//             body: JSON.stringify({
//                 name: "devpkg",
//                 description: "Dev package",
//                 homepage_url: "https://devpkg.example.com",
//                 requires_patching: false
//             })
//         });

//         expect(createRes.status).toBe(201);
//         const createdBody = await createRes.json();

//         const pkg = DB.instance().select().from(DB.Tables.packages).where(eq(DB.Tables.packages.id, createdBody.data.id)).get();
//         expect(pkg?.owner_user_id).toBe(user.id);

//         const updateRes = await API.getApp().request(`/dev/packages/${createdBody.data.id}`, {
//             method: "PUT",
//             headers: {
//                 ...authHeaders(session.token),
//                 "Content-Type": "application/json"
//             },
//             body: JSON.stringify({ description: "Updated description" })
//         });
//         const updateBody = await updateRes.json();
//         expect(updateRes.status).toBe(200);
//         expect(updateBody.message).toBe("Package updated successfully");
//         const updated = DB.instance().select().from(DB.Tables.packages).where(eq(DB.Tables.packages.id, createdBody.data.id)).get();
//         expect(updated?.description).toBe("Updated description");
//     });

//     test("Developer release lifecycle stores data", async () => {
//         const { user } = await seedUser("developer", {
//             display_name: PACKAGE_MAINTAINER_NAME,
//             email: PACKAGE_MAINTAINER_EMAIL
//         });
//         const session = await SessionHandler.createSession(user.id);
//         const pkg = await seedPackage(user.id, { name: PACKAGE_NAME });

//         const listBefore = await API.getApp().request(`/dev/packages/${pkg.id}/releases`, {
//             headers: authHeaders(session.token)
//         });
//         const emptyBody = await listBefore.json();
//         expect(listBefore.status).toBe(200);
//         expect(emptyBody.data).toEqual([]);

//         const file = new File([await Bun.file(PACKAGE_FILE_PATH).arrayBuffer()], "package.deb");
//         const form = new FormData();
//         form.set("file", file);

//         const createRes = await API.getApp().request(`/dev/packages/${pkg.id}/releases/${PACKAGE_VERSION}/${PACKAGE_ARCH}`, {
//             method: "POST",
//             headers: authHeaders(session.token),
//             body: form
//         });
//         const createBody = await createRes.json();
//         expect(createRes.status).toBe(201);
//         expect(createBody.message).toBe("Package release created successfully");


//         const dbRelease = DB.instance().select().from(DB.Tables.packageReleases).where(eq(DB.Tables.packageReleases.package_id, pkg.id)).get();
//         expect(dbRelease?.version).toBe(PACKAGE_VERSION);

//         const listAfter = await API.getApp().request(`/dev/packages/${pkg.id}/releases`, {
//             headers: authHeaders(session.token)
//         });
//         expect(listAfter.status).toBe(200);
//         const afterBody = await listAfter.json();
//         expect(afterBody.data.length).toBe(1);
//     });

//     test("Developer can request stable promotion", async () => {
//         const { user } = await seedUser("developer");
//         const session = await SessionHandler.createSession(user.id);
//         const pkg = await seedPackage(user.id, { name: "stable-pkg" });
//         const release = await seedRelease(pkg.id, "2.0.0", "arm64");

//         const createRes = await API.getApp().request(`/dev/packages/${pkg.id}/stable-promotion-requests`, {
//             method: "POST",
//             headers: {
//                 ...authHeaders(session.token),
//                 "Content-Type": "application/json"
//             },
//             body: JSON.stringify({ package_release_id: release.id })
//         });
//         const createBody = await createRes.json();
//         expect(createRes.status).toBe(201);
//         expect(createBody.message).toBe("Stable promotion request submitted");

//         const listRes = await API.getApp().request(`/dev/packages/${pkg.id}/stable-promotion-requests`, {
//             headers: authHeaders(session.token)
//         });
//         expect(listRes.status).toBe(200);
//         const body = await listRes.json();
//         expect(body.data[0].package_release_id).toBe(release.id);
//     });
// });

// describe("Admin routes", () => {
//     test("Admin can create and delete packages", async () => {
//         const { user: admin } = await seedUser("admin");
//         const { user: developer } = await seedUser("developer");
//         const adminSession = await SessionHandler.createSession(admin.id);

//         const createRes = await API.getApp().request("/admin/packages", {
//             method: "POST",
//             headers: {
//                 ...authHeaders(adminSession.token),
//                 "Content-Type": "application/json"
//             },
//             body: JSON.stringify({
//                 name: "admin-pkg",
//                 owner_user_id: developer.id,
//                 description: "Admin created",
//                 homepage_url: "https://adminpkg.example.com",
//                 requires_patching: false
//             })
//         });
//         expect(createRes.status).toBe(201);
//         const createdBody = await createRes.json();

//         const deleteRes = await API.getApp().request(`/admin/packages/${createdBody.data.id}`, {
//             method: "DELETE",
//             headers: authHeaders(adminSession.token)
//         });
//         const deleteBody = await deleteRes.json();
//         expect(deleteRes.status).toBe(200);
//         expect(deleteBody.message).toBe("Package deleted successfully");
//         const pkg = DB.instance().select().from(DB.Tables.packages).where(eq(DB.Tables.packages.id, createdBody.data.id)).get();
//         expect(pkg).toBeUndefined();
//     });

//     test("Admin user management CRUD", async () => {
//         const { user: admin } = await seedUser("admin");
//         const adminSession = await SessionHandler.createSession(admin.id);

//         const createRes = await API.getApp().request("/admin/users", {
//             method: "POST",
//             headers: {
//                 ...authHeaders(adminSession.token),
//                 "Content-Type": "application/json"
//             },
//             body: JSON.stringify({
//                 username: "managed",
//                 display_name: "Managed User",
//                 email: "managed@example.com",
//                 password: "Adm1nManage!",
//                 role: "user"
//             })
//         });
//         expect(createRes.status).toBe(201);
//         const created = await createRes.json();

//         const updateRes = await API.getApp().request(`/admin/users/${created.data.id}`, {
//             method: "PUT",
//             headers: {
//                 ...authHeaders(adminSession.token),
//                 "Content-Type": "application/json"
//             },
//             body: JSON.stringify({ display_name: "Renamed", role: "developer" })
//         });
//         const updateBody = await updateRes.json();
//         expect(updateRes.status).toBe(200);
//         expect(updateBody.message).toBe("User updated successfully");

//         const passwordRes = await API.getApp().request(`/admin/users/${created.data.id}/password`, {
//             method: "PUT",
//             headers: {
//                 ...authHeaders(adminSession.token),
//                 "Content-Type": "application/json"
//             },
//             body: JSON.stringify({ password: "N3wAdm1nPw" })
//         });
//         expect(passwordRes.status).toBe(200);

//         const deleteRes = await API.getApp().request(`/admin/users/${created.data.id}`, {
//             method: "DELETE",
//             headers: authHeaders(adminSession.token)
//         });
//         expect(deleteRes.status).toBe(200);
//         const deleted = DB.instance().select().from(DB.Tables.users).where(eq(DB.Tables.users.id, created.data.id)).get();
//         expect(deleted).toBeUndefined();
//     });
// });


describe("Global API routes", async () => {

    test("GET /health returns API health payload", async () => {
        const res = await API.getApp().request("/health");
        expect(res.status).toBe(200);

        const body = await res.json() as any;
        expect(body.success).toBe(true);
        expect(body.message).toBe("LeiOS API is running");
    });

    test("GET / redirects to the latest docs while docs are enabled", async () => {
        const res = await API.getApp().request("/");
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/docs/v1");
    });
});


describe("Auth reset-password routes", async () => {

    let resetUser: SeededUser;
    let resetSessionToken: string;

    beforeAll(async () => {
        resetUser = await seedUser("user");
        resetSessionToken = await seedSession(resetUser.id).then(s => s.token);
    });

    test("POST /auth/reset-password/request returns success for existing and unknown emails", async () => {
        await makeAPIRequest("/v1/auth/reset-password/request", {
            method: "POST",
            body: { email: resetUser.email }
        }, 200);

        await makeAPIRequest("/v1/auth/reset-password/request", {
            method: "POST",
            body: { email: `nope-${randomUUID()}@example.com` }
        }, 200);
    });

    test("POST /auth/reset-password/request denies authenticated users", async () => {
        await makeAPIRequest("/v1/auth/reset-password/request", {
            method: "POST",
            authToken: resetSessionToken,
            body: { email: resetUser.email }
        }, 401);
    });

    test("POST /auth/reset-password with invalid token fails", async () => {
        await makeAPIRequest("/v1/auth/reset-password", {
            method: "POST",
            body: {
                reset_token: "invalid-token",
                new_password: "ResetP@ssw0rd1"
            }
        }, 400);
    });

    test("POST /auth/reset-password updates credentials for a valid reset token", async () => {
        const validResetToken = `reset_${randomUUID().replace(/-/g, "")}`;
        const nextPassword = "ResetP@ssw0rd1";
        const wrongLoginIP = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
        const correctLoginIP = `203.0.114.${Math.floor(Math.random() * 200) + 1}`;

        await DB.instance().insert(DB.Tables.passwordResets).values({
            token: validResetToken,
            user_id: resetUser.id,
            expires_at: Date.now() + 10 * 60 * 1000
        }).run();

        await makeAPIRequest("/v1/auth/reset-password", {
            method: "POST",
            body: {
                reset_token: validResetToken,
                new_password: nextPassword
            }
        }, 200);

        await makeAPIRequest("/v1/auth/session", {
            authToken: resetSessionToken
        }, 401);

        await makeAPIRequest("/v1/auth/login", {
            method: "POST",
            body: {
                username: resetUser.username,
                password: resetUser.password
            },
            additionalOptions: {
                headers: {
                    "x-forwarded-for": wrongLoginIP
                }
            }
        }, 401);

        const login = await makeAPIRequest("/v1/auth/login", {
            method: "POST",
            body: {
                username: resetUser.username,
                password: nextPassword
            },
            additionalOptions: {
                headers: {
                    "x-forwarded-for": correctLoginIP
                }
            },
            expectedBodySchema: AuthModel.Login.Response
        }, 200);

        expect(login.token.startsWith("lra_sess_")).toBe(true);
        resetUser.password = nextPassword;
    });
});


describe("Account API key routes", async () => {

    let apiUser: SeededUser;
    let apiUserSessionToken: string;
    let createdApiKeyID: string;

    beforeAll(async () => {
        apiUser = await seedUser("user");
        apiUserSessionToken = await seedSession(apiUser.id).then(s => s.token);
    });

    test("GET /account/apikeys starts empty", async () => {
        const list = await makeAPIRequest("/v1/account/apikeys", {
            authToken: apiUserSessionToken
        }, 200);

        expect(list).toEqual([]);
    });

    test("POST /account/apikeys creates an API key", async () => {
        const created = await makeAPIRequest("/v1/account/apikeys", {
            method: "POST",
            authToken: apiUserSessionToken,
            body: {
                description: "CI key",
                expires_at: "30d"
            }
        }, 200);

        expect(created.id).toBeString();
        expect(created.token).toBeString();

        createdApiKeyID = created.id;
    });

    test("GET /account/apikeys/:apiKeyID returns key details", async () => {
        const key = await makeAPIRequest(`/v1/account/apikeys/${createdApiKeyID}`, {
            authToken: apiUserSessionToken
        }, 200);

        expect(key.id).toBe(createdApiKeyID);
        expect(key.description).toBe("CI key");
    });

    test("DELETE /account/apikeys/:apiKeyID removes key", async () => {
        await makeAPIRequest(`/v1/account/apikeys/${createdApiKeyID}`, {
            method: "DELETE",
            authToken: apiUserSessionToken
        }, 200);

        await makeAPIRequest(`/v1/account/apikeys/${createdApiKeyID}`, {
            authToken: apiUserSessionToken
        }, 404);
    });
});


describe("Publisher and member routes", async () => {

    let owner: SeededUser;
    let ownerSessionToken: string;
    let member: SeededUser;
    let memberSessionToken: string;
    let newOwner: SeededUser;
    let newOwnerSessionToken: string;

    let publisherName: string;
    let publisherID: number;

    beforeAll(async () => {
        owner = await seedUser("user");
        member = await seedUser("user");
        newOwner = await seedUser("user");

        ownerSessionToken = await seedSession(owner.id).then(s => s.token);
        memberSessionToken = await seedSession(member.id).then(s => s.token);
        newOwnerSessionToken = await seedSession(newOwner.id).then(s => s.token);

        const seededPublisher = await seedPublisherWithOwner(owner.id, {
            name: `pub-${randomUUID().slice(0, 8)}`,
            display_name: "Coverage Publisher",
            description: "Publisher route coverage",
            homepage_url: "https://publisher.example.com"
        });

        publisherName = seededPublisher.name;
        publisherID = seededPublisher.id;
    });

    test("POST /publishers requires authentication", async () => {
        await makeAPIRequest("/v1/publishers", {
            method: "POST",
            body: {
                name: `pub-${randomUUID().slice(0, 8)}`,
                display_name: "Coverage Publisher",
                description: "Publisher route coverage",
                homepage_url: "https://publisher.example.com"
            }
        }, 401);
    });

    test("GET /publishers supports membership filtering", async () => {
        const unauthList = await makeAPIRequest("/v1/publishers?onlyMembershipByMe=true", {}, 200);
        expect(unauthList).toEqual([]);

        const authList = await makeAPIRequest("/v1/publishers?onlyMembershipByMe=true", {
            authToken: ownerSessionToken
        }, 200);

        expect(authList).toEqual([]);
    });

    test("GET /publishers/:publisherName returns publisher details", async () => {
        const publisher = await makeAPIRequest(`/v1/publishers/${publisherName}`, {}, 200);
        expect(publisher.id).toBe(publisherID);
        expect(publisher.name).toBe(publisherName);
    });

    test("PUT /publishers/:publisherName updates publisher as owner", async () => {
        await makeAPIRequest(`/v1/publishers/${publisherName}`, {
            method: "PUT",
            authToken: ownerSessionToken,
            body: {
                description: "Updated description"
            }
        }, 200);

        const updated = DB.instance().select().from(DB.Tables.publishers).where(eq(DB.Tables.publishers.id, publisherID)).get();
        expect(updated?.description).toBe("Updated description");
    });

    test("POST /publishers/:publisherName/members enforces member-management permission", async () => {
        await makeAPIRequest(`/v1/publishers/${publisherName}/members`, {
            method: "POST",
            authToken: memberSessionToken,
            body: {
                user_id: newOwner.id,
                role: PermissionHelper.OrgRoles.VIEWER,
            }
        }, 403);
    });

    test("GET /publishers/:publisherName/members returns members list", async () => {
        const list = await makeAPIRequest(`/v1/publishers/${publisherName}/members`, {}, 200);

        expect(list).toEqual([]);
    });

    test("PUT /publishers/:publisherName/members/:userId returns 404 for missing member", async () => {
        await makeAPIRequest(`/v1/publishers/${publisherName}/members/${member.id}`, {
            method: "PUT",
            authToken: ownerSessionToken,
            body: {
                role: PermissionHelper.OrgRoles.DEVELOPER,
            }
        }, 404);
    });

    test("DELETE /publishers/:publisherName/members/:userId returns 404 for missing member", async () => {
        await makeAPIRequest(`/v1/publishers/${publisherName}/members/${member.id}`, {
            method: "DELETE",
            authToken: ownerSessionToken
        }, 404);
    });

    test("POST /publishers/:publisherName/transfer-ownership is owner-only", async () => {
        await makeAPIRequest(`/v1/publishers/${publisherName}/transfer-ownership`, {
            method: "POST",
            authToken: newOwnerSessionToken,
            body: {
                new_owner_user_id: newOwner.id
            }
        }, 403);
    });

    test("DELETE /publishers/:publisherName denies non-owner", async () => {
        await makeAPIRequest(`/v1/publishers/${publisherName}`, {
            method: "DELETE",
            authToken: newOwnerSessionToken
        }, 403);
    });

    test("DELETE /publishers/:publisherName allows owner", async () => {
        await makeAPIRequest(`/v1/publishers/${publisherName}`, {
            method: "DELETE",
            authToken: ownerSessionToken
        }, 200);

        const publisher = DB.instance().select().from(DB.Tables.publishers).where(eq(DB.Tables.publishers.id, publisherID)).get();
        expect(publisher).toBeUndefined();
    });
});


describe("Package sub-routes coverage", async () => {

    let owner: SeededUser;
    let ownerSessionToken: string;
    let developer: SeededUser;
    let developerSessionToken: string;
    let viewer: SeededUser;
    let viewerSessionToken: string;

    let publisher: DB.Models.Publisher;
    let packageName: string;
    let packageID: number;
    let releaseID: number;
    let stablePromotionRequestID: number;

    beforeAll(async () => {
        owner = await seedUser("user");
        developer = await seedUser("user");
        viewer = await seedUser("user");

        ownerSessionToken = await seedSession(owner.id).then(s => s.token);
        developerSessionToken = await seedSession(developer.id).then(s => s.token);
        viewerSessionToken = await seedSession(viewer.id).then(s => s.token);

        publisher = await seedPublisherWithOwner(owner.id);
    });

    test("POST /packages creates a package", async () => {
        packageName = `pkg-${randomUUID().slice(0, 8)}`;

        const created = await makeAPIRequest("/v1/packages", {
            method: "POST",
            authToken: ownerSessionToken,
            body: {
                publisher_id: publisher.id,
                name: packageName,
                display_name: "Coverage Package",
                description: "Package coverage tests",
                homepage_url: "https://package.example.com",
                requires_patching: false
            }
        }, 201);

        packageID = created.id;
        expect(created.id).toBeNumber();
    });

    test("GET /packages lists packages for publisherName filter", async () => {
        const list = await makeAPIRequest(`/v1/packages?publisherName=${publisher.name}`, {
            expectedBodySchema: PackageModel.GetAll.Response
        }, 200);

        expect(list.some(pkg => pkg.id === packageID)).toBe(true);
    });

    test("GET /packages/:publisherName/:packageName returns package", async () => {
        const pkg = await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}`, {}, 200);
        expect(pkg.id).toBe(packageID);
    });

    test("PUT /packages/:publisherName/:packageName updates package", async () => {
        await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}`, {
            method: "PUT",
            authToken: ownerSessionToken,
            body: {
                description: "Updated package coverage description"
            }
        }, 200);

        const pkg = DB.instance().select().from(DB.Tables.packages).where(eq(DB.Tables.packages.id, packageID)).get();
        expect(pkg?.description).toBe("Updated package coverage description");
    });

    test("DELETE /packages/:publisherName/:packageName is forbidden for developer role", async () => {
        await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}`, {
            method: "DELETE",
            authToken: developerSessionToken
        }, 403);
    });

    test("GET /packages/:publisherName/:packageName/releases lists releases", async () => {
        const releases = await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}/releases`, {}, 200);
        expect(releases).toEqual([]);
    });

    test("POST /packages/:publisherName/:packageName/releases creates release", async () => {
        await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}/releases`, {
            method: "POST",
            authToken: ownerSessionToken,
            body: {
                version_with_leios_patch: "1.0.0",
                changelog: "Initial release"
            }
        }, 201);

        const release = DB.instance().select().from(DB.Tables.packageReleases).where(and(
            eq(DB.Tables.packageReleases.package_id, packageID),
            eq(DB.Tables.packageReleases.version_with_leios_patch, "1.0.0")
        )).get();

        expect(release).toBeDefined();
        releaseID = release!.id;
    });

    test("GET /packages/:publisherName/:packageName/releases/:version_with_leios_patch returns release", async () => {
        const release = await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}/releases/1.0.0`, {}, 200);
        expect(release.id).toBe(releaseID);
    });

    test("PUT /packages/:publisherName/:packageName/releases/:version_with_leios_patch updates release", async () => {
        await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}/releases/1.0.0`, {
            method: "PUT",
            authToken: ownerSessionToken,
            body: {
                changelog: "Updated release changelog"
            }
        }, 200);

        const release = DB.instance().select().from(DB.Tables.packageReleases).where(eq(DB.Tables.packageReleases.id, releaseID)).get();
        expect(release?.changelog).toBe("Updated release changelog");
    });

    test("POST /packages/:publisherName/:packageName/releases/:version_with_leios_patch/:arch checks publish permission", async () => {
        const formData = new FormData();
        formData.set("file", new File(["fake-deb"], "fake.deb"));

        await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}/releases/1.0.0/amd64`, {
            method: "POST",
            authToken: viewerSessionToken,
            additionalOptions: {
                body: formData
            }
        }, 403);
    });

    test("DELETE /packages/:publisherName/:packageName/releases/:version_with_leios_patch is forbidden for developer", async () => {
        await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}/releases/1.0.0`, {
            method: "DELETE",
            authToken: developerSessionToken
        }, 403);
    });

    test("POST /packages/:publisherName/:packageName/stable-promotion-requests creates request", async () => {
        const created = await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}/stable-promotion-requests`, {
            method: "POST",
            authToken: ownerSessionToken,
            body: {
                package_release_id: releaseID
            }
        }, 201);

        stablePromotionRequestID = created.id;
        expect(created.id).toBeNumber();
    });

    test("GET /packages/:publisherName/:packageName/stable-promotion-requests lists requests", async () => {
        const list = await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}/stable-promotion-requests`, {}, 200);
        expect(list.some((item: any) => item.id === stablePromotionRequestID)).toBe(true);
    });

    test("GET /packages/:publisherName/:packageName/stable-promotion-requests/:stablePromotionRequestID returns request", async () => {
        const item = await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}/stable-promotion-requests/${stablePromotionRequestID}`, {}, 200);
        expect(item.id).toBe(stablePromotionRequestID);
    });

    test("DELETE /packages/:publisherName/:packageName/stable-promotion-requests/:stablePromotionRequestID removes request", async () => {
        await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}/stable-promotion-requests/${stablePromotionRequestID}`, {
            method: "DELETE",
            authToken: ownerSessionToken
        }, 200);

        const request = DB.instance().select().from(DB.Tables.stablePromotionRequests).where(
            eq(DB.Tables.stablePromotionRequests.id, stablePromotionRequestID)
        ).get();

        expect(request).toBeUndefined();
    });

    test("GET /packages/:publisherName/:packageName/role-assignments lists assignments", async () => {
        const list = await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}/role-assignments`, {
            authToken: ownerSessionToken
        }, 200);

        expect(Array.isArray(list)).toBe(true);
    });

    test("POST /packages/:publisherName/:packageName/role-assignments creates assignment", async () => {
        await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}/role-assignments`, {
            method: "POST",
            authToken: ownerSessionToken,
            body: {
                user_id: developer.id,
                role: PermissionHelper.OrgRoles.MAINTAINER
            }
        }, 201);

        const assignment = DB.instance().select().from(DB.Tables.roleAssignments).where(and(
            eq(DB.Tables.roleAssignments.package_id, packageID),
            eq(DB.Tables.roleAssignments.user_id, developer.id)
        )).get();

        expect(assignment?.role).toBe(PermissionHelper.OrgRoles.MAINTAINER);
    });

    test("PUT /packages/:publisherName/:packageName/role-assignments/:userId updates assignment", async () => {
        await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}/role-assignments/${developer.id}`, {
            method: "PUT",
            authToken: ownerSessionToken,
            body: {
                role: PermissionHelper.OrgRoles.ADMIN
            }
        }, 200);

        const assignment = DB.instance().select().from(DB.Tables.roleAssignments).where(and(
            eq(DB.Tables.roleAssignments.package_id, packageID),
            eq(DB.Tables.roleAssignments.user_id, developer.id)
        )).get();

        expect(assignment?.role).toBe(PermissionHelper.OrgRoles.ADMIN);
    });

    test("DELETE /packages/:publisherName/:packageName/role-assignments/:userId removes assignment", async () => {
        await makeAPIRequest(`/v1/packages/${publisher.name}/${packageName}/role-assignments/${developer.id}`, {
            method: "DELETE",
            authToken: ownerSessionToken,
        }, 200);

        const assignment = DB.instance().select().from(DB.Tables.roleAssignments).where(and(
            eq(DB.Tables.roleAssignments.package_id, packageID),
            eq(DB.Tables.roleAssignments.user_id, developer.id)
        )).get();

        expect(assignment).toBeUndefined();
    });
});


describe("Admin sub-routes coverage", async () => {

    let adminUser: SeededUser;
    let adminSessionToken: string;

    let managedUserID: number;

    let taskWithoutLogsID: number;
    let manualOSReleaseVersion: string;

    let stableRequestID: number;

    beforeAll(async () => {
        adminUser = await seedUser("admin");
        adminSessionToken = await seedSession(adminUser.id).then(s => s.token);

        const taskWithoutLogs = await seedTask({
            function: "test:no-logs",
            created_by_user_id: adminUser.id,
            storeLogs: false,
            status: "pending"
        });
        taskWithoutLogsID = taskWithoutLogs.id;

        const osReleaseTask = await seedTask({
            function: "test:os-release",
            created_by_user_id: adminUser.id,
            storeLogs: false,
            status: "completed",
            finished_at: Date.now()
        });

        manualOSReleaseVersion = `2098.01.${String(Math.floor(Math.random() * 900) + 100)}`;

        await DB.instance().insert(DB.Tables.os_releases).values({
            version: manualOSReleaseVersion,
            changelog: "Manual OS release entry",
            taskID: osReleaseTask.id
        }).run();

        const requestOwner = await seedUser("user");
        const requestPublisher = await seedPublisherWithOwner(requestOwner.id);

        const requestPackage = await DB.instance().insert(DB.Tables.packages).values({
            publisher_id: requestPublisher.id,
            name: `stable-pkg-${randomUUID().slice(0, 8)}`,
            display_name: "Stable Request Package",
            description: "Package for admin stable request route tests",
            homepage_url: "https://stable-route.example.com",
            requires_patching: false
        }).returning().get();

        const requestRelease = await DB.instance().insert(DB.Tables.packageReleases).values({
            package_id: requestPackage.id,
            version_with_leios_patch: "3.2.1",
            changelog: "Stable request release"
        }).returning().get();

        const request = await DB.instance().insert(DB.Tables.stablePromotionRequests).values({
            package_id: requestPackage.id,
            package_release_id: requestRelease.id,
            status: "pending"
        }).returning().get();

        stableRequestID = request.id;
    });

    test("GET /admin/users lists users", async () => {
        const users = await makeAPIRequest("/v1/admin/users", {
            authToken: adminSessionToken
        }, 200);

        expect(Array.isArray(users)).toBe(true);
        expect(users.length).toBeGreaterThan(0);
    });

    test("POST /admin/users creates a user", async () => {
        const seed = randomUUID().slice(0, 8);

        const created = await makeAPIRequest("/v1/admin/users", {
            method: "POST",
            authToken: adminSessionToken,
            body: {
                username: `managed_${seed}`,
                display_name: "Managed User",
                email: `managed_${seed}@example.com`,
                password: "Adm1nManage!",
                role: "user"
            }
        }, 201);

        managedUserID = created.id;
        expect(created.id).toBeNumber();
    });

    test("GET /admin/users/:userId returns user", async () => {
        const user = await makeAPIRequest(`/v1/admin/users/${managedUserID}`, {
            authToken: adminSessionToken
        }, 200);

        expect(user.id).toBe(managedUserID);
    });

    test("PUT /admin/users/:userId updates user", async () => {
        const updated = await makeAPIRequest(`/v1/admin/users/${managedUserID}`, {
            method: "PUT",
            authToken: adminSessionToken,
            body: {
                display_name: "Renamed Managed User",
                role: "developer"
            }
        }, 200);

        expect(updated.id).toBe(managedUserID);
        expect(updated.display_name).toBe("Renamed Managed User");
        expect(updated.role).toBe("developer");
    });

    test("PUT /admin/users/:userId/password resets password", async () => {
        await makeAPIRequest(`/v1/admin/users/${managedUserID}/password`, {
            method: "PUT",
            authToken: adminSessionToken,
            body: {
                password: "N3wAdm1nPw!"
            }
        }, 200);
    });

    test("GET /admin/tasks lists scheduled tasks", async () => {
        const tasks = await makeAPIRequest("/v1/admin/tasks", {
            authToken: adminSessionToken
        }, 200);

        expect(Array.isArray(tasks)).toBe(true);
        expect(tasks.some((task: any) => task.id === taskWithoutLogsID)).toBe(true);
    });

    test("GET /admin/tasks/:taskID returns task", async () => {
        const task = await makeAPIRequest(`/v1/admin/tasks/${taskWithoutLogsID}`, {
            authToken: adminSessionToken
        }, 200);

        expect(task.id).toBe(taskWithoutLogsID);
    });

    test("GET /admin/tasks/:taskID/logs rejects tasks without log storage", async () => {
        await makeAPIRequest(`/v1/admin/tasks/${taskWithoutLogsID}/logs`, {
            authToken: adminSessionToken
        }, 400);
    });

    test("GET /admin/os-releases lists os releases", async () => {
        const releases = await makeAPIRequest("/v1/admin/os-releases", {
            authToken: adminSessionToken
        }, 200);

        expect(Array.isArray(releases)).toBe(true);
        expect(releases.some((rel: any) => rel.version === manualOSReleaseVersion)).toBe(true);
    });

    test("GET /admin/os-releases/:version returns os release", async () => {
        const release = await makeAPIRequest(`/v1/admin/os-releases/${manualOSReleaseVersion}`, {
            authToken: adminSessionToken
        }, 200);

        expect(release.version).toBe(manualOSReleaseVersion);
    });

    test("GET /admin/os-releases/:version/publishing-logs returns 404 when logs are missing", async () => {
        await makeAPIRequest(`/v1/admin/os-releases/${manualOSReleaseVersion}/publishing-logs`, {
            authToken: adminSessionToken
        }, 404);
    });

    test("PUT /admin/os-releases/:version updates os release", async () => {
        await makeAPIRequest(`/v1/admin/os-releases/${manualOSReleaseVersion}`, {
            method: "PUT",
            authToken: adminSessionToken,
            body: {
                changelog: "Updated manual OS release changelog"
            }
        }, 200);

        const updated = DB.instance().select().from(DB.Tables.os_releases).where(
            eq(DB.Tables.os_releases.version, manualOSReleaseVersion)
        ).get();

        expect(updated?.changelog).toBe("Updated manual OS release changelog");
    });

    test("POST /admin/os-releases enqueues new os release task", async () => {
        const created = await makeAPIRequest("/v1/admin/os-releases", {
            method: "POST",
            authToken: adminSessionToken,
            body: {
                changelog: "Queued OS release from coverage test"
            }
        }, 202);

        expect(created.version).toBeString();
    });

    test("GET /admin/stable-promotion-requests lists requests", async () => {
        const list = await makeAPIRequest("/v1/admin/stable-promotion-requests", {
            authToken: adminSessionToken
        }, 200);

        expect(Array.isArray(list)).toBe(true);
        expect(list.some((req: any) => req.id === stableRequestID)).toBe(true);
    });

    test("GET /admin/stable-promotion-requests/:stablePromotionRequestID returns request", async () => {
        const request = await makeAPIRequest(`/v1/admin/stable-promotion-requests/${stableRequestID}`, {
            authToken: adminSessionToken
        }, 200);

        expect(request.id).toBe(stableRequestID);
    });

    test("POST /admin/stable-promotion-requests/:stablePromotionRequestID/decide updates request status", async () => {
        await makeAPIRequest(`/v1/admin/stable-promotion-requests/${stableRequestID}/decide`, {
            method: "POST",
            authToken: adminSessionToken,
            body: {
                status: "denied",
                admin_note: "Not ready for stable"
            }
        }, 200);

        const updatedRequest = DB.instance().select().from(DB.Tables.stablePromotionRequests).where(
            eq(DB.Tables.stablePromotionRequests.id, stableRequestID)
        ).get();

        expect(updatedRequest?.status).toBe("denied");
    });

    test("DELETE /admin/users/:userId deletes user", async () => {
        await makeAPIRequest(`/v1/admin/users/${managedUserID}`, {
            method: "DELETE",
            authToken: adminSessionToken
        }, 200);

        const deleted = DB.instance().select().from(DB.Tables.users).where(eq(DB.Tables.users.id, managedUserID)).get();
        expect(deleted).toBeUndefined();
    });
});


describe("Docs Routes", async () => {

    test("GET /docs/v1/openapi returns API docs if enabled", async () => {
        await makeAPIRequest("/docs/v1/openapi", {}, 200);
    });

    test("GET /docs/v1 returns API docs UI if enabled", async () => {
        await makeAPIRequest("/docs/v1", {}, 200);
    });

    test("GET /docs/v1/openapi returns 404 if disabled", async () => {

        await API.stop();
        await API.init([], true);
        await API.start(14123, "::");

        await makeAPIRequest("/docs/v1/openapi", {}, 404);
    });

    test("GET /docs/v1 returns 404 if disabled", async () => {

        await makeAPIRequest("/docs/v1", {}, 404);
    });
});