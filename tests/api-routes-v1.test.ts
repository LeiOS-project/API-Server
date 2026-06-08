import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdir } from "fs/promises";
import { API } from "../src/api";
import { DB } from "../src/db";
import { AuthHandler, AuthUtils, SessionHandler } from "../src/api/utils/authHandler";
import { AptlyAPI } from "../src/aptly/api";
import { randomUUID } from "crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { AuthModel } from "../src/api/versions/v1/routes/auth/model";
import { makeAPIRequest } from "./helpers/api";
import { AccountModel } from "../src/api/versions/v1/routes/account/model";
import { hashResetToken } from "../src/api/versions/v1/routes/auth/reset-password";
import { PackageModel } from "../src/api/utils/shared-models/package";
import { PermissionHelper } from "../src/utils/permission-helper";
import { RuntimeMetadata } from "../src/api/utils/metadata";
import { TaskScheduler } from "../src/tasks";
import { TEST_PACKAGE_FIXTURES } from "./helpers/package-fixtures";

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

async function upsertPublisherMember(
    publisher_id: number,
    user_id: number,
    role: PermissionHelper.OrgRoles,
    is_publicly_hidden = false
) {
    const existing = DB.instance().select().from(DB.Tables.publisherMembers).where(and(
        eq(DB.Tables.publisherMembers.publisher_id, publisher_id),
        eq(DB.Tables.publisherMembers.user_id, user_id)
    )).get();

    if (existing) {
        await DB.instance().update(DB.Tables.publisherMembers).set({
            role,
            is_publicly_hidden
        }).where(eq(DB.Tables.publisherMembers.id, existing.id));

        return DB.instance().select().from(DB.Tables.publisherMembers).where(eq(DB.Tables.publisherMembers.id, existing.id)).get()!;
    }

    return DB.instance().insert(DB.Tables.publisherMembers).values({
        publisher_id,
        user_id,
        role,
        is_publicly_hidden
    }).returning().get();
}

async function seedPackageForPublisher(publisher_id: number, overrides: Partial<DB.Models.Package> = {}) {
    const name = overrides.name ?? `pkg-${randomUUID().slice(0, 8)}`;

    return DB.instance().insert(DB.Tables.packages).values({
        publisher_id,
        name,
        display_name: overrides.display_name ?? `Package ${name}`,
        description: overrides.description ?? "Seeded package",
        homepage_url: overrides.homepage_url ?? `https://${name}.example.com`,
        requires_patching: overrides.requires_patching ?? false,
        flags: overrides.flags,
    }).returning().get();
}

async function seedPackageRelease(package_id: number, overrides: Partial<DB.Models.PackageRelease> = {}) {
    return DB.instance().insert(DB.Tables.packageReleases).values({
        package_id,
        version_with_leios_patch: overrides.version_with_leios_patch ?? `1.0.${Math.floor(Math.random() * 9000) + 1000}`,
        changelog: overrides.changelog ?? "Seeded release",
        architectures: overrides.architectures ?? {
            amd64: false,
            arm64: false,
            is_all: false
        }
    }).returning().get();
}

async function seedStablePromotionRequest(
    package_id: number,
    package_release_id: number,
    overrides: Partial<DB.Models.StablePromotionRequest> = {}
) {
    return DB.instance().insert(DB.Tables.stablePromotionRequests).values({
        package_id,
        package_release_id,
        status: overrides.status ?? "pending",
        admin_note: overrides.admin_note
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

async function writeStoredTaskLog(taskID: number, content: string) {
    const logDir = process.env.LRA_LOG_DIR ?? "./data/logs";
    await mkdir(`${logDir}/tasks`, { recursive: true });
    await Bun.write(`${logDir}/tasks/task-${taskID}.log`, content);
}

async function waitForTaskById(taskID: number, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const task = DB.instance().select().from(DB.Tables.scheduled_tasks).where(
            eq(DB.Tables.scheduled_tasks.id, taskID)
        ).get();

        if (task && (task.status === "completed" || task.status === "failed")) {
            return task;
        }

        await Bun.sleep(100);
    }

    throw new Error(`Timed out waiting for task ${taskID} to finish`);
}

async function waitForLatestTaskByFunction(functionName: string, minCreatedAt: number, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const task = DB.instance().select().from(DB.Tables.scheduled_tasks).where(and(
            eq(DB.Tables.scheduled_tasks.function, functionName),
            gte(DB.Tables.scheduled_tasks.created_at, minCreatedAt)
        )).orderBy(desc(DB.Tables.scheduled_tasks.created_at)).get();

        if (task && (task.status === "completed" || task.status === "failed")) {
            return task;
        }

        await Bun.sleep(100);
    }

    throw new Error(`Timed out waiting for latest '${functionName}' task to finish`);
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

    test("GET /auth/session with invalid authorization header fails", async () => {
        await makeAPIRequest("/v1/auth/session", {
            additionalOptions: {
                headers: {
                    Authorization: "Token invalid"
                }
            }
        }, 401);
    });

    test("GET /auth/session with empty bearer token fails", async () => {
        await makeAPIRequest("/v1/auth/session", {
            additionalOptions: {
                headers: {
                    Authorization: "Bearer "
                }
            }
        }, 401);
    });

    test("POST /auth/login rate limits repeated failures", async () => {
        const rateLimitedUser = await seedUser("user", {}, "LimitP@ss1");

        for (let attempt = 0; attempt < 5; attempt++) {
            await makeAPIRequest("/v1/auth/login", {
                method: "POST",
                body: {
                    username: rateLimitedUser.username,
                    password: "WrongPassword"
                }
            }, 401);
        }

        await makeAPIRequest("/v1/auth/login", {
            method: "POST",
            body: {
                username: rateLimitedUser.username,
                password: "WrongPassword"
            }
        }, 429);
    });

    test("POST /auth/login clears failed-attempt counter after successful login", async () => {
        const resetUser = await seedUser("user", {}, "ResetLimitP@ss1");

        for (let attempt = 0; attempt < 4; attempt++) {
            await makeAPIRequest("/v1/auth/login", {
                method: "POST",
                body: {
                    username: resetUser.username,
                    password: "WrongPassword"
                }
            }, 401);
        }

        const login = await makeAPIRequest("/v1/auth/login", {
            method: "POST",
            body: {
                username: resetUser.username,
                password: resetUser.password
            },
            expectedBodySchema: AuthModel.Login.Response
        }, 200);

        expect(login.token.startsWith("lra_sess_")).toBe(true);

        for (let attempt = 0; attempt < 5; attempt++) {
            await makeAPIRequest("/v1/auth/login", {
                method: "POST",
                body: {
                    username: resetUser.username,
                    password: "WrongPassword"
                }
            }, 401);
        }

        await makeAPIRequest("/v1/auth/login", {
            method: "POST",
            body: {
                username: resetUser.username,
                password: "WrongPassword"
            }
        }, 429);
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
            email: "updated@example.com",
            current_password: testUser.password
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
            token: hashResetToken(validResetToken),
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
    let fullPackageName: string;
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

        const packageName = `pkg-${randomUUID().slice(0, 8)}`;
        fullPackageName = `${publisher.name}.${packageName}`;

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
            } satisfies PackageModel.CreatePackage.Body
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

    test("GET /packages/:fullPackageName returns package", async () => {
        const pkg = await makeAPIRequest(`/v1/packages/${fullPackageName}`, {}, 200);
        expect(pkg.id).toBe(packageID);
    });

    test("PUT /packages/:fullPackageName updates package", async () => {
        await makeAPIRequest(`/v1/packages/${fullPackageName}`, {
            method: "PUT",
            authToken: ownerSessionToken,
            body: {
                description: "Updated package coverage description"
            }
        }, 200);

        const pkg = DB.instance().select().from(DB.Tables.packages).where(eq(DB.Tables.packages.id, packageID)).get();
        expect(pkg?.description).toBe("Updated package coverage description");
    });

    test("DELETE /packages/:fullPackageName is forbidden for developer role", async () => {
        await makeAPIRequest(`/v1/packages/${fullPackageName}`, {
            method: "DELETE",
            authToken: developerSessionToken
        }, 403);
    });

    test("GET /packages/:fullPackageName/releases lists releases", async () => {
        const releases = await makeAPIRequest(`/v1/packages/${fullPackageName}/releases`, {}, 200);
        expect(releases).toEqual([]);
    });

    test("POST /packages/:fullPackageName/releases creates release", async () => {
        await makeAPIRequest(`/v1/packages/${fullPackageName}/releases`, {
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

    test("POST /packages/:fullPackageName/releases enforces requires_patching version format", async () => {
        const patchedPackageName = `pkg-patched-${randomUUID().slice(0, 8)}`;
        const patchedFullPackageName = `${publisher.name}.${patchedPackageName}`;

        await makeAPIRequest("/v1/packages", {
            method: "POST",
            authToken: ownerSessionToken,
            body: {
                publisher_id: publisher.id,
                name: patchedPackageName,
                display_name: "Patched Coverage Package",
                description: "Requires patch suffix coverage",
                homepage_url: "https://patched-coverage.example.com",
                requires_patching: true
            } satisfies PackageModel.CreatePackage.Body
        }, 201);

        await makeAPIRequest(`/v1/packages/${patchedFullPackageName}/releases`, {
            method: "POST",
            authToken: ownerSessionToken,
            body: {
                version_with_leios_patch: "1.0.0",
                changelog: "Missing required LeiOS suffix"
            }
        }, 400);

        await makeAPIRequest(`/v1/packages/${patchedFullPackageName}/releases`, {
            method: "POST",
            authToken: ownerSessionToken,
            body: {
                version_with_leios_patch: "1.0.0leios1",
                changelog: "Has required LeiOS suffix"
            }
        }, 201);
    });

    test("GET /packages/:fullPackageName/releases/:version_with_leios_patch returns release", async () => {
        const release = await makeAPIRequest(`/v1/packages/${fullPackageName}/releases/1.0.0`, {}, 200);
        expect(release.id).toBe(releaseID);
    });

    test("PUT /packages/:fullPackageName/releases/:version_with_leios_patch updates release", async () => {
        await makeAPIRequest(`/v1/packages/${fullPackageName}/releases/1.0.0`, {
            method: "PUT",
            authToken: ownerSessionToken,
            body: {
                changelog: "Updated release changelog"
            }
        }, 200);

        const release = DB.instance().select().from(DB.Tables.packageReleases).where(eq(DB.Tables.packageReleases.id, releaseID)).get();
        expect(release?.changelog).toBe("Updated release changelog");
    });

    test("POST /packages/:fullPackageName/releases/:version_with_leios_patch/:arch checks publish permission", async () => {
        const formData = new FormData();
        formData.set("file", new File(["fake-deb"], "fake.deb"));

        await makeAPIRequest(`/v1/packages/${fullPackageName}/releases/1.0.0/amd64`, {
            method: "POST",
            authToken: viewerSessionToken,
            additionalOptions: {
                body: formData
            }
        }, 403);
    });

    test("DELETE /packages/:fullPackageName/releases/:version_with_leios_patch is forbidden for developer", async () => {
        await makeAPIRequest(`/v1/packages/${fullPackageName}/releases/1.0.0`, {
            method: "DELETE",
            authToken: developerSessionToken
        }, 403);
    });

    test("POST /packages/:fullPackageName/stable-promotion-requests creates request", async () => {
        const created = await makeAPIRequest(`/v1/packages/${fullPackageName}/stable-promotion-requests`, {
            method: "POST",
            authToken: ownerSessionToken,
            body: {
                package_release_id: releaseID
            }
        }, 201);

        stablePromotionRequestID = created.id;
        expect(created.id).toBeNumber();
    });

    test("GET /packages/:fullPackageName/stable-promotion-requests lists requests", async () => {
        const list = await makeAPIRequest(`/v1/packages/${fullPackageName}/stable-promotion-requests`, {}, 200);
        expect(list.some((item: any) => item.id === stablePromotionRequestID)).toBe(true);
    });

    test("GET /packages/:fullPackageName/stable-promotion-requests/:stablePromotionRequestID returns request", async () => {
        const item = await makeAPIRequest(`/v1/packages/${fullPackageName}/stable-promotion-requests/${stablePromotionRequestID}`, {}, 200);
        expect(item.id).toBe(stablePromotionRequestID);
    });

    test("DELETE /packages/:fullPackageName/stable-promotion-requests/:stablePromotionRequestID removes request", async () => {
        await makeAPIRequest(`/v1/packages/${fullPackageName}/stable-promotion-requests/${stablePromotionRequestID}`, {
            method: "DELETE",
            authToken: ownerSessionToken
        }, 200);

        const request = DB.instance().select().from(DB.Tables.stablePromotionRequests).where(
            eq(DB.Tables.stablePromotionRequests.id, stablePromotionRequestID)
        ).get();

        expect(request).toBeUndefined();
    });

    test("GET /packages/:fullPackageName/role-assignments lists assignments", async () => {
        const list = await makeAPIRequest(`/v1/packages/${fullPackageName}/role-assignments`, {
            authToken: ownerSessionToken
        }, 200);

        expect(Array.isArray(list)).toBe(true);
    });

    test("POST /packages/:fullPackageName/role-assignments creates assignment", async () => {
        await makeAPIRequest(`/v1/packages/${fullPackageName}/role-assignments`, {
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

    test("GET /packages/:fullPackageName/role-assignments includes user info and publisher_role in response", async () => {
        const list = await makeAPIRequest(`/v1/packages/${fullPackageName}/role-assignments`, {
            authToken: ownerSessionToken
        }, 200);

        expect(Array.isArray(list)).toBe(true);
        expect(list.length).toBeGreaterThanOrEqual(1);

        const devAssign = list.find((a: any) => a.user_id === developer.id);
        expect(devAssign).toBeDefined();
        expect(devAssign.user_username).toBe(developer.username);
        expect(devAssign).toHaveProperty("user_display_name");
        expect(devAssign).toHaveProperty("publisher_role");
        // developer is not a publisher member, so publisher_role should be null
        expect(devAssign.publisher_role).toBeNull();
    });

    test("POST /packages/:fullPackageName/role-assignments rejects duplicate assignment", async () => {
        await makeAPIRequest(`/v1/packages/${fullPackageName}/role-assignments`, {
            method: "POST",
            authToken: ownerSessionToken,
            body: {
                user_id: developer.id,
                role: PermissionHelper.OrgRoles.ADMIN
            }
        }, 409);
    });

    test("PUT /packages/:fullPackageName/role-assignments/:userId updates assignment", async () => {
        await makeAPIRequest(`/v1/packages/${fullPackageName}/role-assignments/${developer.id}`, {
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

    test("DELETE /packages/:fullPackageName/role-assignments/:userId removes assignment", async () => {
        await makeAPIRequest(`/v1/packages/${fullPackageName}/role-assignments/${developer.id}`, {
            method: "DELETE",
            authToken: ownerSessionToken,
        }, 200);

        const assignment = DB.instance().select().from(DB.Tables.roleAssignments).where(and(
            eq(DB.Tables.roleAssignments.package_id, packageID),
            eq(DB.Tables.roleAssignments.user_id, developer.id)
        )).get();

        expect(assignment).toBeUndefined();
    });

    test("PUT /packages/:fullPackageName/role-assignments/:userId returns 404 when assignment is missing", async () => {
        await makeAPIRequest(`/v1/packages/${fullPackageName}/role-assignments/${developer.id}`, {
            method: "PUT",
            authToken: ownerSessionToken,
            body: {
                role: PermissionHelper.OrgRoles.DEVELOPER
            }
        }, 404);
    });

    test("DELETE /packages/:fullPackageName/role-assignments/:userId returns 404 when assignment is missing", async () => {
        await makeAPIRequest(`/v1/packages/${fullPackageName}/role-assignments/${developer.id}`, {
            method: "DELETE",
            authToken: ownerSessionToken,
        }, 404);
    });
});


describe("Publisher permission matrix coverage", async () => {

    let owner: SeededUser;
    let ownerSessionToken: string;
    let siteAdmin: SeededUser;
    let siteAdminSessionToken: string;
    let orgAdmin: SeededUser;
    let orgAdminSessionToken: string;
    let maintainer: SeededUser;
    let maintainerSessionToken: string;
    let developer: SeededUser;
    let developerSessionToken: string;
    let viewer: SeededUser;
    let viewerSessionToken: string;
    let outsider: SeededUser;
    let outsiderSessionToken: string;
    let hiddenMemberUser: SeededUser;
    let transferTarget: SeededUser;

    let publisher: DB.Models.Publisher;

    beforeAll(async () => {
        owner = await seedUser("user");
        siteAdmin = await seedUser("admin");
        orgAdmin = await seedUser("user");
        maintainer = await seedUser("user");
        developer = await seedUser("user");
        viewer = await seedUser("user");
        outsider = await seedUser("user");
        hiddenMemberUser = await seedUser("user");
        transferTarget = await seedUser("user");

        ownerSessionToken = await seedSession(owner.id).then(s => s.token);
        siteAdminSessionToken = await seedSession(siteAdmin.id).then(s => s.token);
        orgAdminSessionToken = await seedSession(orgAdmin.id).then(s => s.token);
        maintainerSessionToken = await seedSession(maintainer.id).then(s => s.token);
        developerSessionToken = await seedSession(developer.id).then(s => s.token);
        viewerSessionToken = await seedSession(viewer.id).then(s => s.token);
        outsiderSessionToken = await seedSession(outsider.id).then(s => s.token);

        publisher = await seedPublisherWithOwner(owner.id, {
            name: `pub-perm-${randomUUID().slice(0, 8)}`,
            display_name: "Publisher Permission Coverage",
            description: "Publisher permission matrix",
            homepage_url: "https://publisher-permissions.example.com"
        });

        await upsertPublisherMember(publisher.id, orgAdmin.id, PermissionHelper.OrgRoles.ADMIN);
        await upsertPublisherMember(publisher.id, maintainer.id, PermissionHelper.OrgRoles.MAINTAINER);
        await upsertPublisherMember(publisher.id, developer.id, PermissionHelper.OrgRoles.DEVELOPER);
        await upsertPublisherMember(publisher.id, viewer.id, PermissionHelper.OrgRoles.VIEWER);
        await upsertPublisherMember(publisher.id, hiddenMemberUser.id, PermissionHelper.OrgRoles.VIEWER, true);
    });

    test("GET /publishers?onlyMembershipByMe=true scopes by membership records", async () => {
        const unauth = await makeAPIRequest("/v1/publishers?onlyMembershipByMe=true", {}, 200);
        expect(unauth).toEqual([]);

        const ownerList = await makeAPIRequest("/v1/publishers?onlyMembershipByMe=true", {
            authToken: ownerSessionToken
        }, 200);
        expect(ownerList.some((p: any) => p.id === publisher.id)).toBe(false);

        const outsiderList = await makeAPIRequest("/v1/publishers?onlyMembershipByMe=true", {
            authToken: outsiderSessionToken
        }, 200);
        expect(outsiderList.some((p: any) => p.id === publisher.id)).toBe(false);

        const memberList = await makeAPIRequest("/v1/publishers?onlyMembershipByMe=true", {
            authToken: orgAdminSessionToken
        }, 200);
        expect(memberList.some((p: any) => p.id === publisher.id)).toBe(true);
    });

    test("PUT /publishers/:publisherName enforces publisher.update permission matrix", async () => {
        const cases: Array<{ label: string; token?: string; code: number; }> = [
            { label: "unauth", code: 403 },
            { label: "outsider", token: outsiderSessionToken, code: 403 },
            { label: "viewer", token: viewerSessionToken, code: 403 },
            { label: "developer", token: developerSessionToken, code: 403 },
            { label: "maintainer", token: maintainerSessionToken, code: 403 },
            { label: "org-admin", token: orgAdminSessionToken, code: 200 },
            { label: "site-admin", token: siteAdminSessionToken, code: 200 },
            { label: "owner", token: ownerSessionToken, code: 200 },
        ];

        for (const current of cases) {
            await makeAPIRequest(`/v1/publishers/${publisher.name}`, {
                method: "PUT",
                authToken: current.token,
                body: {
                    description: `publisher-update-${current.label}-${randomUUID().slice(0, 6)}`
                }
            }, current.code);
        }
    });

    test("GET /publishers/:publisherName/members hides hidden members from unauthenticated and outsiders", async () => {
        const unauth = await makeAPIRequest(`/v1/publishers/${publisher.name}/members`, {}, 200);
        expect(unauth.some((m: any) => m.user_id === hiddenMemberUser.id)).toBe(false);

        const outsiderList = await makeAPIRequest(`/v1/publishers/${publisher.name}/members`, {
            authToken: outsiderSessionToken
        }, 200);
        expect(outsiderList.some((m: any) => m.user_id === hiddenMemberUser.id)).toBe(false);

        const memberList = await makeAPIRequest(`/v1/publishers/${publisher.name}/members`, {
            authToken: viewerSessionToken
        }, 200);
        expect(memberList.some((m: any) => m.user_id === hiddenMemberUser.id)).toBe(true);

        const siteAdminList = await makeAPIRequest(`/v1/publishers/${publisher.name}/members`, {
            authToken: siteAdminSessionToken
        }, 200);
        expect(siteAdminList.some((m: any) => m.user_id === hiddenMemberUser.id)).toBe(true);
    });

    test("GET /publishers/:publisherName/members/:userId only reveals hidden members to members/admins", async () => {
        await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${hiddenMemberUser.id}`, {}, 404);

        await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${hiddenMemberUser.id}`, {
            authToken: outsiderSessionToken
        }, 404);

        const memberView = await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${hiddenMemberUser.id}`, {
            authToken: viewerSessionToken
        }, 200);
        expect(memberView.user_id).toBe(hiddenMemberUser.id);

        const adminView = await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${hiddenMemberUser.id}`, {
            authToken: siteAdminSessionToken
        }, 200);
        expect(adminView.user_id).toBe(hiddenMemberUser.id);
    });

    test("POST /publishers/:publisherName/members enforces invite permissions and hierarchy", async () => {
        const deniedCases: Array<{ token?: string; role: PermissionHelper.OrgRoles; }> = [
            { role: PermissionHelper.OrgRoles.VIEWER },
            { token: outsiderSessionToken, role: PermissionHelper.OrgRoles.VIEWER },
            { token: viewerSessionToken, role: PermissionHelper.OrgRoles.VIEWER },
            { token: developerSessionToken, role: PermissionHelper.OrgRoles.VIEWER },
            { token: maintainerSessionToken, role: PermissionHelper.OrgRoles.VIEWER },
        ];

        for (const denied of deniedCases) {
            const invitee = await seedUser("user");
            await makeAPIRequest(`/v1/publishers/${publisher.name}/members`, {
                method: "POST",
                authToken: denied.token,
                body: {
                    user_id: invitee.id,
                    role: denied.role,
                }
            }, 403);
        }

        const orgAdminCannotInviteAdmin = await seedUser("user");
        await makeAPIRequest(`/v1/publishers/${publisher.name}/members`, {
            method: "POST",
            authToken: orgAdminSessionToken,
            body: {
                user_id: orgAdminCannotInviteAdmin.id,
                role: PermissionHelper.OrgRoles.ADMIN,
            }
        }, 403);

        const orgAdminCanInviteMaintainer = await seedUser("user");
        await makeAPIRequest(`/v1/publishers/${publisher.name}/members`, {
            method: "POST",
            authToken: orgAdminSessionToken,
            body: {
                user_id: orgAdminCanInviteMaintainer.id,
                role: PermissionHelper.OrgRoles.MAINTAINER,
            }
        }, 201);

        const ownerCanInviteAdmin = await seedUser("user");
        await makeAPIRequest(`/v1/publishers/${publisher.name}/members`, {
            method: "POST",
            authToken: ownerSessionToken,
            body: {
                user_id: ownerCanInviteAdmin.id,
                role: PermissionHelper.OrgRoles.ADMIN,
            }
        }, 201);

        const siteAdminCanInviteAdmin = await seedUser("user");
        await makeAPIRequest(`/v1/publishers/${publisher.name}/members`, {
            method: "POST",
            authToken: siteAdminSessionToken,
            body: {
                user_id: siteAdminCanInviteAdmin.id,
                role: PermissionHelper.OrgRoles.ADMIN,
            }
        }, 201);
    });

    test("PUT /publishers/:publisherName/members/:userId enforces update permissions and hierarchy", async () => {
        const editableTarget = await seedUser("user");
        await upsertPublisherMember(publisher.id, editableTarget.id, PermissionHelper.OrgRoles.VIEWER);

        const deniedTokens = [undefined, outsiderSessionToken, viewerSessionToken, developerSessionToken, maintainerSessionToken];
        for (const token of deniedTokens) {
            await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${editableTarget.id}`, {
                method: "PUT",
                authToken: token,
                body: {
                    role: PermissionHelper.OrgRoles.DEVELOPER,
                }
            }, 403);
        }

        await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${editableTarget.id}`, {
            method: "PUT",
            authToken: orgAdminSessionToken,
            body: {
                role: PermissionHelper.OrgRoles.DEVELOPER,
            }
        }, 200);

        await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${editableTarget.id}`, {
            method: "PUT",
            authToken: orgAdminSessionToken,
            body: {
                role: PermissionHelper.OrgRoles.ADMIN,
            }
        }, 403);

        await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${editableTarget.id}`, {
            method: "PUT",
            authToken: ownerSessionToken,
            body: {
                role: PermissionHelper.OrgRoles.ADMIN,
            }
        }, 200);

        await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${editableTarget.id}`, {
            method: "PUT",
            authToken: siteAdminSessionToken,
            body: {
                role: PermissionHelper.OrgRoles.VIEWER,
            }
        }, 200);
    });

    test("PUT /publishers/:publisherName/members/:userId blocks owner membership changes", async () => {
        await upsertPublisherMember(publisher.id, owner.id, PermissionHelper.OrgRoles.ADMIN);

        await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${owner.id}`, {
            method: "PUT",
            authToken: ownerSessionToken,
            body: {
                is_publicly_hidden: true
            }
        }, 400);

        await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${owner.id}`, {
            method: "PUT",
            authToken: siteAdminSessionToken,
            body: {
                role: PermissionHelper.OrgRoles.VIEWER
            }
        }, 400);
    });

    test("DELETE /publishers/:publisherName/members/:userId enforces remove permissions and hierarchy", async () => {
        const lowRoleTarget = await seedUser("user");
        await upsertPublisherMember(publisher.id, lowRoleTarget.id, PermissionHelper.OrgRoles.VIEWER);

        const deniedTokens = [undefined, outsiderSessionToken, viewerSessionToken, developerSessionToken, maintainerSessionToken];
        for (const token of deniedTokens) {
            await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${lowRoleTarget.id}`, {
                method: "DELETE",
                authToken: token,
            }, 403);
        }

        await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${lowRoleTarget.id}`, {
            method: "DELETE",
            authToken: orgAdminSessionToken,
        }, 200);

        const peerAdminTarget = await seedUser("user");
        await upsertPublisherMember(publisher.id, peerAdminTarget.id, PermissionHelper.OrgRoles.ADMIN);

        await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${peerAdminTarget.id}`, {
            method: "DELETE",
            authToken: orgAdminSessionToken,
        }, 403);

        await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${peerAdminTarget.id}`, {
            method: "DELETE",
            authToken: ownerSessionToken,
        }, 200);

        const secondAdminTarget = await seedUser("user");
        await upsertPublisherMember(publisher.id, secondAdminTarget.id, PermissionHelper.OrgRoles.ADMIN);

        await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${secondAdminTarget.id}`, {
            method: "DELETE",
            authToken: siteAdminSessionToken,
        }, 200);
    });

    test("DELETE /publishers/:publisherName/members/:userId blocks owner membership removal", async () => {
        await upsertPublisherMember(publisher.id, owner.id, PermissionHelper.OrgRoles.ADMIN);

        await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${owner.id}`, {
            method: "DELETE",
            authToken: ownerSessionToken,
        }, 400);

        await makeAPIRequest(`/v1/publishers/${publisher.name}/members/${owner.id}`, {
            method: "DELETE",
            authToken: siteAdminSessionToken,
        }, 400);
    });

    test("POST /publishers/:publisherName/transfer-ownership is owner/site-admin only and ensures owner membership", async () => {
        await makeAPIRequest(`/v1/publishers/${publisher.name}/transfer-ownership`, {
            method: "POST",
            body: {
                new_owner_user_id: transferTarget.id
            }
        }, 401);

        await makeAPIRequest(`/v1/publishers/${publisher.name}/transfer-ownership`, {
            method: "POST",
            authToken: outsiderSessionToken,
            body: {
                new_owner_user_id: transferTarget.id
            }
        }, 403);

        await makeAPIRequest(`/v1/publishers/${publisher.name}/transfer-ownership`, {
            method: "POST",
            authToken: orgAdminSessionToken,
            body: {
                new_owner_user_id: transferTarget.id
            }
        }, 403);

        await makeAPIRequest(`/v1/publishers/${publisher.name}/transfer-ownership`, {
            method: "POST",
            authToken: ownerSessionToken,
            body: {
                new_owner_user_id: transferTarget.id
            }
        }, 200);

        const transferred = DB.instance().select().from(DB.Tables.publishers).where(eq(DB.Tables.publishers.id, publisher.id)).get();
        expect(transferred?.owner_user_id).toBe(transferTarget.id);

        const transferTargetMembership = DB.instance().select().from(DB.Tables.publisherMembers).where(and(
            eq(DB.Tables.publisherMembers.publisher_id, publisher.id),
            eq(DB.Tables.publisherMembers.user_id, transferTarget.id)
        )).get();

        expect(transferTargetMembership?.role).toBe(PermissionHelper.OrgRoles.ADMIN);
        expect(transferTargetMembership?.is_publicly_hidden).toBe(false);

        await makeAPIRequest(`/v1/publishers/${publisher.name}/transfer-ownership`, {
            method: "POST",
            authToken: siteAdminSessionToken,
            body: {
                new_owner_user_id: owner.id
            }
        }, 200);

        const transferredBack = DB.instance().select().from(DB.Tables.publishers).where(eq(DB.Tables.publishers.id, publisher.id)).get();
        expect(transferredBack?.owner_user_id).toBe(owner.id);
    });

    test("DELETE /publishers/:publisherName enforces owner/site-admin and package-empty rules", async () => {
        const blockingPackage = await seedPackageForPublisher(publisher.id, {
            name: `pkg-block-${randomUUID().slice(0, 8)}`,
            description: "Used to block publisher deletion"
        });

        await makeAPIRequest(`/v1/publishers/${publisher.name}`, {
            method: "DELETE",
            authToken: ownerSessionToken,
        }, 400);

        await DB.instance().delete(DB.Tables.packages).where(eq(DB.Tables.packages.id, blockingPackage.id));

        await makeAPIRequest(`/v1/publishers/${publisher.name}`, {
            method: "DELETE",
            authToken: outsiderSessionToken,
        }, 403);

        await makeAPIRequest(`/v1/publishers/${publisher.name}`, {
            method: "DELETE",
            authToken: orgAdminSessionToken,
        }, 403);

        await makeAPIRequest(`/v1/publishers/${publisher.name}`, {
            method: "DELETE",
        }, 401);

        await makeAPIRequest(`/v1/publishers/${publisher.name}`, {
            method: "DELETE",
            authToken: siteAdminSessionToken,
        }, 200);

        const deleted = DB.instance().select().from(DB.Tables.publishers).where(eq(DB.Tables.publishers.id, publisher.id)).get();
        expect(deleted).toBeUndefined();
    });
});


describe("Publisher package-route permission matrix", async () => {

    let owner: SeededUser;
    let ownerSessionToken: string;
    let siteAdmin: SeededUser;
    let siteAdminSessionToken: string;
    let orgAdmin: SeededUser;
    let orgAdminSessionToken: string;
    let maintainer: SeededUser;
    let maintainerSessionToken: string;
    let developer: SeededUser;
    let developerSessionToken: string;
    let viewer: SeededUser;
    let viewerSessionToken: string;
    let outsider: SeededUser;
    let outsiderSessionToken: string;

    let publisher: DB.Models.Publisher;

    beforeAll(async () => {
        owner = await seedUser("user");
        siteAdmin = await seedUser("admin");
        orgAdmin = await seedUser("user");
        maintainer = await seedUser("user");
        developer = await seedUser("user");
        viewer = await seedUser("user");
        outsider = await seedUser("user");

        ownerSessionToken = await seedSession(owner.id).then(s => s.token);
        siteAdminSessionToken = await seedSession(siteAdmin.id).then(s => s.token);
        orgAdminSessionToken = await seedSession(orgAdmin.id).then(s => s.token);
        maintainerSessionToken = await seedSession(maintainer.id).then(s => s.token);
        developerSessionToken = await seedSession(developer.id).then(s => s.token);
        viewerSessionToken = await seedSession(viewer.id).then(s => s.token);
        outsiderSessionToken = await seedSession(outsider.id).then(s => s.token);

        publisher = await seedPublisherWithOwner(owner.id, {
            name: `pkg-perm-${randomUUID().slice(0, 8)}`,
            display_name: "Package Permission Publisher",
            description: "Publisher for package permission matrix",
            homepage_url: "https://package-permissions.example.com"
        });

        await upsertPublisherMember(publisher.id, orgAdmin.id, PermissionHelper.OrgRoles.ADMIN);
        await upsertPublisherMember(publisher.id, maintainer.id, PermissionHelper.OrgRoles.MAINTAINER);
        await upsertPublisherMember(publisher.id, developer.id, PermissionHelper.OrgRoles.DEVELOPER);
        await upsertPublisherMember(publisher.id, viewer.id, PermissionHelper.OrgRoles.VIEWER);
    });

    test("POST /packages enforces create permissions", async () => {
        const cases: Array<{ label: string; token?: string; code: number; }> = [
            { label: "unauth", code: 401 },
            { label: "outsider", token: outsiderSessionToken, code: 403 },
            { label: "viewer", token: viewerSessionToken, code: 403 },
            { label: "developer", token: developerSessionToken, code: 201 },
            { label: "maintainer", token: maintainerSessionToken, code: 201 },
            { label: "org-admin", token: orgAdminSessionToken, code: 201 },
            { label: "owner", token: ownerSessionToken, code: 201 },
            { label: "site-admin", token: siteAdminSessionToken, code: 201 },
        ];

        for (const current of cases) {
            const created = await makeAPIRequest("/v1/packages", {
                method: "POST",
                authToken: current.token,
                body: {
                    publisher_id: publisher.id,
                    name: `pkg-create-${current.label}-${randomUUID().slice(0, 6)}`,
                    display_name: `Create Matrix ${current.label}`,
                    description: "Create permission matrix",
                    homepage_url: "https://pkg-create-matrix.example.com",
                    requires_patching: false
                }
            }, current.code);

            if (current.code === 201) {
                expect(created.id).toBeNumber();
            }
        }
    });

    test("PUT /packages/:fullPackageName enforces package update permissions", async () => {
        const pkg = await seedPackageForPublisher(publisher.id, {
            name: `pkg-update-${randomUUID().slice(0, 8)}`,
            description: "Initial update permission package"
        });

        const cases: Array<{ token?: string; code: number; }> = [
            { code: 403 },
            { token: outsiderSessionToken, code: 403 },
            { token: viewerSessionToken, code: 403 },
            { token: developerSessionToken, code: 403 },
            { token: maintainerSessionToken, code: 200 },
            { token: orgAdminSessionToken, code: 200 },
            { token: ownerSessionToken, code: 200 },
            { token: siteAdminSessionToken, code: 200 },
        ];

        for (const current of cases) {
            await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}`, {
                method: "PUT",
                authToken: current.token,
                body: {
                    description: `package-update-${randomUUID().slice(0, 8)}`
                }
            }, current.code);
        }
    });

    test("DELETE /packages/:fullPackageName blocks non-delete roles", async () => {
        const deniedCases: Array<{ token?: string; }> = [
            {},
            { token: outsiderSessionToken },
            { token: viewerSessionToken },
            { token: developerSessionToken },
            { token: maintainerSessionToken },
        ];

        for (const denied of deniedCases) {
            const pkg = await seedPackageForPublisher(publisher.id, {
                name: `pkg-delete-denied-${randomUUID().slice(0, 8)}`,
                description: "Delete denied matrix package"
            });

            await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}`, {
                method: "DELETE",
                authToken: denied.token,
            }, 403);
        }
    });

    test("POST /packages/:fullPackageName/releases enforces publish permissions", async () => {
        const cases: Array<{ label: string; token?: string; code: number; }> = [
            { label: "unauth", code: 403 },
            { label: "outsider", token: outsiderSessionToken, code: 403 },
            { label: "viewer", token: viewerSessionToken, code: 403 },
            { label: "developer", token: developerSessionToken, code: 201 },
            { label: "maintainer", token: maintainerSessionToken, code: 201 },
            { label: "org-admin", token: orgAdminSessionToken, code: 201 },
            { label: "owner", token: ownerSessionToken, code: 201 },
            { label: "site-admin", token: siteAdminSessionToken, code: 201 },
        ];

        for (const current of cases) {
            const pkg = await seedPackageForPublisher(publisher.id, {
                name: `pkg-release-create-${current.label}-${randomUUID().slice(0, 6)}`,
            });

            await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/releases`, {
                method: "POST",
                authToken: current.token,
                body: {
                    version_with_leios_patch: `2.0.${Math.floor(Math.random() * 9000) + 1000}`,
                    changelog: "Release create permission matrix"
                }
            }, current.code);
        }
    });

    test("PUT /packages/:fullPackageName/releases/:version enforces release update permissions", async () => {
        const cases: Array<{ token?: string; code: number; }> = [
            { code: 403 },
            { token: outsiderSessionToken, code: 403 },
            { token: viewerSessionToken, code: 403 },
            { token: developerSessionToken, code: 403 },
            { token: maintainerSessionToken, code: 200 },
            { token: orgAdminSessionToken, code: 200 },
            { token: ownerSessionToken, code: 200 },
            { token: siteAdminSessionToken, code: 200 },
        ];

        for (const current of cases) {
            const pkg = await seedPackageForPublisher(publisher.id, {
                name: `pkg-release-update-${randomUUID().slice(0, 8)}`,
            });
            const release = await seedPackageRelease(pkg.id, {
                version_with_leios_patch: `3.0.${Math.floor(Math.random() * 9000) + 1000}`,
                changelog: "Before update"
            });

            await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/releases/${release.version_with_leios_patch}`, {
                method: "PUT",
                authToken: current.token,
                body: {
                    changelog: `After update ${randomUUID().slice(0, 6)}`
                }
            }, current.code);
        }
    });

    test("DELETE /packages/:fullPackageName/releases/:version blocks non-delete roles", async () => {
        const deniedCases: Array<{ token?: string; }> = [
            {},
            { token: outsiderSessionToken },
            { token: viewerSessionToken },
            { token: developerSessionToken },
            { token: maintainerSessionToken },
        ];

        for (const denied of deniedCases) {
            const pkg = await seedPackageForPublisher(publisher.id, {
                name: `pkg-release-delete-${randomUUID().slice(0, 8)}`,
            });
            const release = await seedPackageRelease(pkg.id, {
                version_with_leios_patch: `4.0.${Math.floor(Math.random() * 9000) + 1000}`,
            });

            await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/releases/${release.version_with_leios_patch}`, {
                method: "DELETE",
                authToken: denied.token,
            }, 403);
        }
    });

    test("POST /packages/:fullPackageName/releases/:version/:arch blocks non-publish roles", async () => {
        const pkg = await seedPackageForPublisher(publisher.id, {
            name: `pkg-release-upload-${randomUUID().slice(0, 8)}`,
        });
        const release = await seedPackageRelease(pkg.id, {
            version_with_leios_patch: "9.9.9"
        });

        const formData = new FormData();
        formData.set("file", new File(["fake-deb"], "fake.deb"));

        const deniedCases: Array<{ token?: string; }> = [
            {},
            { token: outsiderSessionToken },
            { token: viewerSessionToken },
        ];

        for (const denied of deniedCases) {
            await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/releases/${release.version_with_leios_patch}/amd64`, {
                method: "POST",
                authToken: denied.token,
                additionalOptions: {
                    body: formData
                }
            }, 403);
        }
    });

    test("POST /packages/:fullPackageName/stable-promotion-requests enforces requestStable permissions", async () => {
        const cases: Array<{ label: string; token?: string; code: number; }> = [
            { label: "unauth", code: 403 },
            { label: "outsider", token: outsiderSessionToken, code: 403 },
            { label: "viewer", token: viewerSessionToken, code: 403 },
            { label: "developer", token: developerSessionToken, code: 201 },
            { label: "maintainer", token: maintainerSessionToken, code: 201 },
            { label: "org-admin", token: orgAdminSessionToken, code: 201 },
            { label: "owner", token: ownerSessionToken, code: 201 },
            { label: "site-admin", token: siteAdminSessionToken, code: 201 },
        ];

        for (const current of cases) {
            const pkg = await seedPackageForPublisher(publisher.id, {
                name: `pkg-stable-create-${current.label}-${randomUUID().slice(0, 6)}`,
            });
            const release = await seedPackageRelease(pkg.id, {
                version_with_leios_patch: `5.0.${Math.floor(Math.random() * 9000) + 1000}`,
            });

            const created = await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/stable-promotion-requests`, {
                method: "POST",
                authToken: current.token,
                body: {
                    package_release_id: release.id
                }
            }, current.code);

            if (current.code === 201) {
                expect(created.id).toBeNumber();
            }
        }
    });

    test("DELETE /packages/:fullPackageName/stable-promotion-requests/:id enforces requestStable permissions", async () => {
        const cases: Array<{ token?: string; code: number; }> = [
            { code: 403 },
            { token: outsiderSessionToken, code: 403 },
            { token: viewerSessionToken, code: 403 },
            { token: developerSessionToken, code: 200 },
            { token: maintainerSessionToken, code: 200 },
            { token: orgAdminSessionToken, code: 200 },
            { token: ownerSessionToken, code: 200 },
            { token: siteAdminSessionToken, code: 200 },
        ];

        for (const current of cases) {
            const pkg = await seedPackageForPublisher(publisher.id, {
                name: `pkg-stable-delete-${randomUUID().slice(0, 8)}`,
            });
            const release = await seedPackageRelease(pkg.id, {
                version_with_leios_patch: `6.0.${Math.floor(Math.random() * 9000) + 1000}`,
            });
            const request = await seedStablePromotionRequest(pkg.id, release.id);

            await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/stable-promotion-requests/${request.id}`, {
                method: "DELETE",
                authToken: current.token,
            }, current.code);
        }
    });

    test("GET /packages/:fullPackageName/role-assignments enforces list permissions", async () => {
        const pkg = await seedPackageForPublisher(publisher.id, {
            name: `pkg-role-list-${randomUUID().slice(0, 8)}`,
        });

        const cases: Array<{ token?: string; code: number; }> = [
            { code: 403 },
            { token: outsiderSessionToken, code: 403 },
            { token: viewerSessionToken, code: 403 },
            { token: developerSessionToken, code: 403 },
            { token: maintainerSessionToken, code: 403 },
            { token: orgAdminSessionToken, code: 200 },
            { token: ownerSessionToken, code: 200 },
            { token: siteAdminSessionToken, code: 200 },
        ];

        for (const current of cases) {
            await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/role-assignments`, {
                authToken: current.token,
            }, current.code);
        }
    });

    test("POST /packages/:fullPackageName/role-assignments enforces permissions and strict role escalation", async () => {
        const pkg = await seedPackageForPublisher(publisher.id, {
            name: `pkg-role-create-${randomUUID().slice(0, 8)}`,
        });

        const deniedCases: Array<{ token?: string; }> = [
            {},
            { token: outsiderSessionToken },
            { token: viewerSessionToken },
            { token: developerSessionToken },
            { token: maintainerSessionToken },
        ];

        for (const denied of deniedCases) {
            const target = await seedUser("user");
            await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/role-assignments`, {
                method: "POST",
                authToken: denied.token,
                body: {
                    user_id: target.id,
                    role: PermissionHelper.OrgRoles.VIEWER
                }
            }, 403);
        }

        const strictTarget = await seedUser("user");
        await upsertPublisherMember(publisher.id, strictTarget.id, PermissionHelper.OrgRoles.VIEWER);

        await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/role-assignments`, {
            method: "POST",
            authToken: ownerSessionToken,
            body: {
                user_id: strictTarget.id,
                role: PermissionHelper.OrgRoles.VIEWER
            }
        }, 400);

        await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/role-assignments`, {
            method: "POST",
            authToken: ownerSessionToken,
            body: {
                user_id: strictTarget.id,
                role: PermissionHelper.OrgRoles.DEVELOPER
            }
        }, 201);

        const orgAdminAllowedTarget = await seedUser("user");
        await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/role-assignments`, {
            method: "POST",
            authToken: orgAdminSessionToken,
            body: {
                user_id: orgAdminAllowedTarget.id,
                role: PermissionHelper.OrgRoles.VIEWER
            }
        }, 201);

        const siteAdminAllowedTarget = await seedUser("user");
        await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/role-assignments`, {
            method: "POST",
            authToken: siteAdminSessionToken,
            body: {
                user_id: siteAdminAllowedTarget.id,
                role: PermissionHelper.OrgRoles.VIEWER
            }
        }, 201);
    });

    test("PUT /packages/:fullPackageName/role-assignments/:userId enforces permissions and strict role escalation", async () => {
        const pkg = await seedPackageForPublisher(publisher.id, {
            name: `pkg-role-update-${randomUUID().slice(0, 8)}`,
        });

        const deniedCases: Array<{ token?: string; }> = [
            {},
            { token: outsiderSessionToken },
            { token: viewerSessionToken },
            { token: developerSessionToken },
            { token: maintainerSessionToken },
        ];

        for (const denied of deniedCases) {
            const target = await seedUser("user");
            await DB.instance().insert(DB.Tables.roleAssignments).values({
                package_id: pkg.id,
                user_id: target.id,
                role: PermissionHelper.OrgRoles.VIEWER
            }).run();

            await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/role-assignments/${target.id}`, {
                method: "PUT",
                authToken: denied.token,
                body: {
                    role: PermissionHelper.OrgRoles.DEVELOPER
                }
            }, 403);
        }

        const strictTarget = await seedUser("user");
        await upsertPublisherMember(publisher.id, strictTarget.id, PermissionHelper.OrgRoles.DEVELOPER);
        await DB.instance().insert(DB.Tables.roleAssignments).values({
            package_id: pkg.id,
            user_id: strictTarget.id,
            role: PermissionHelper.OrgRoles.ADMIN
        }).run();

        await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/role-assignments/${strictTarget.id}`, {
            method: "PUT",
            authToken: ownerSessionToken,
            body: {
                role: PermissionHelper.OrgRoles.DEVELOPER
            }
        }, 400);

        const orgAdminAllowedTarget = await seedUser("user");
        await DB.instance().insert(DB.Tables.roleAssignments).values({
            package_id: pkg.id,
            user_id: orgAdminAllowedTarget.id,
            role: PermissionHelper.OrgRoles.VIEWER
        }).run();

        await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/role-assignments/${orgAdminAllowedTarget.id}`, {
            method: "PUT",
            authToken: orgAdminSessionToken,
            body: {
                role: PermissionHelper.OrgRoles.DEVELOPER
            }
        }, 200);

        const ownerAllowedTarget = await seedUser("user");
        await DB.instance().insert(DB.Tables.roleAssignments).values({
            package_id: pkg.id,
            user_id: ownerAllowedTarget.id,
            role: PermissionHelper.OrgRoles.VIEWER
        }).run();

        await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/role-assignments/${ownerAllowedTarget.id}`, {
            method: "PUT",
            authToken: ownerSessionToken,
            body: {
                role: PermissionHelper.OrgRoles.DEVELOPER
            }
        }, 200);

        const siteAdminAllowedTarget = await seedUser("user");
        await DB.instance().insert(DB.Tables.roleAssignments).values({
            package_id: pkg.id,
            user_id: siteAdminAllowedTarget.id,
            role: PermissionHelper.OrgRoles.VIEWER
        }).run();

        await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/role-assignments/${siteAdminAllowedTarget.id}`, {
            method: "PUT",
            authToken: siteAdminSessionToken,
            body: {
                role: PermissionHelper.OrgRoles.DEVELOPER
            }
        }, 200);
    });

    test("DELETE /packages/:fullPackageName/role-assignments/:userId enforces permissions", async () => {
        const pkg = await seedPackageForPublisher(publisher.id, {
            name: `pkg-role-delete-${randomUUID().slice(0, 8)}`,
        });

        const deniedCases: Array<{ token?: string; }> = [
            {},
            { token: outsiderSessionToken },
            { token: viewerSessionToken },
            { token: developerSessionToken },
            { token: maintainerSessionToken },
        ];

        for (const denied of deniedCases) {
            const target = await seedUser("user");
            await DB.instance().insert(DB.Tables.roleAssignments).values({
                package_id: pkg.id,
                user_id: target.id,
                role: PermissionHelper.OrgRoles.VIEWER
            }).run();

            await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/role-assignments/${target.id}`, {
                method: "DELETE",
                authToken: denied.token,
            }, 403);
        }

        const orgAdminAllowedTarget = await seedUser("user");
        await DB.instance().insert(DB.Tables.roleAssignments).values({
            package_id: pkg.id,
            user_id: orgAdminAllowedTarget.id,
            role: PermissionHelper.OrgRoles.VIEWER
        }).run();

        await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/role-assignments/${orgAdminAllowedTarget.id}`, {
            method: "DELETE",
            authToken: orgAdminSessionToken,
        }, 200);

        const ownerAllowedTarget = await seedUser("user");
        await DB.instance().insert(DB.Tables.roleAssignments).values({
            package_id: pkg.id,
            user_id: ownerAllowedTarget.id,
            role: PermissionHelper.OrgRoles.VIEWER
        }).run();

        await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/role-assignments/${ownerAllowedTarget.id}`, {
            method: "DELETE",
            authToken: ownerSessionToken,
        }, 200);

        const siteAdminAllowedTarget = await seedUser("user");
        await DB.instance().insert(DB.Tables.roleAssignments).values({
            package_id: pkg.id,
            user_id: siteAdminAllowedTarget.id,
            role: PermissionHelper.OrgRoles.VIEWER
        }).run();

        await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/role-assignments/${siteAdminAllowedTarget.id}`, {
            method: "DELETE",
            authToken: siteAdminSessionToken,
        }, 200);
    });
});


describe("User search routes", async () => {

    let userA: SeededUser;
    let userB: SeededUser;
    let userCSession: string;

    beforeAll(async () => {
        userA = await seedUser("user", {
            username: "alice_search",
            display_name: "Alice Searchable"
        });

        userB = await seedUser("developer", {
            username: "bob_searchable",
            display_name: "Bob Developer"
        });

        await seedUser("user", {
            username: "charlie_no_match",
            display_name: "Charlie Hidden"
        });

        userCSession = await seedSession(userA.id).then(s => s.token);
    });

    test("GET /users/search returns 401 when not authenticated", async () => {
        await makeAPIRequest("/v1/users/search?q=alice", {}, 401);
    });

    test("GET /users/search matches by username", async () => {
        const result = await makeAPIRequest("/v1/users/search?q=alice_search", {
            authToken: userCSession
        }, 200);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThanOrEqual(1);
        const match = result.find((u: any) => u.id === userA.id);
        expect(match).toBeDefined();
        expect(match!.username).toBe("alice_search");
        expect(match!.display_name).toBe("Alice Searchable");
        // Should not expose email or role
        expect(match).not.toHaveProperty("email");
        expect(match).not.toHaveProperty("role");
    });

    test("GET /users/search matches by display name", async () => {
        const result = await makeAPIRequest("/v1/users/search?q=Bob+Developer", {
            authToken: userCSession
        }, 200);

        expect(Array.isArray(result)).toBe(true);
        const match = result.find((u: any) => u.id === userB.id);
        expect(match).toBeDefined();
        expect(match!.username).toBe("bob_searchable");
        expect(match!.display_name).toBe("Bob Developer");
    });

    test("GET /users/search returns empty array for no matches", async () => {
        const result = await makeAPIRequest("/v1/users/search?q=zzzzzznonexistent", {
            authToken: userCSession
        }, 200);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
    });

    test("GET /users/search respects limit parameter", async () => {
        const result = await makeAPIRequest("/v1/users/search?q=search&limit=1", {
            authToken: userCSession
        }, 200);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeLessThanOrEqual(1);
    });
});


describe("Admin sub-routes coverage", async () => {

    let adminUser: SeededUser;
    let adminSessionToken: string;

    let managedUserID: number;

    let taskWithLogsID: number;
    let taskWithoutLogsID: number;
    let manualOSReleaseVersion: string;

    let stableRequestID: number;

    beforeAll(async () => {
        adminUser = await seedUser("admin");
        adminSessionToken = await seedSession(adminUser.id).then(s => s.token);

        const taskWithLogs = await seedTask({
            function: "test:with-logs",
            created_by_user_id: adminUser.id,
            storeLogs: true,
            status: "completed",
            finished_at: Date.now()
        });
        taskWithLogsID = taskWithLogs.id;
        await writeStoredTaskLog(taskWithLogsID, "stored task log coverage\nline 2");

        const taskWithoutLogs = await seedTask({
            function: "test:no-logs",
            created_by_user_id: adminUser.id,
            storeLogs: false,
            status: "completed",
            finished_at: Date.now()
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

    test("GET /admin/tasks/:taskID/logs returns stored logs", async () => {
        const logs = await makeAPIRequest(`/v1/admin/tasks/${taskWithLogsID}/logs`, {
            authToken: adminSessionToken
        }, 200);

        expect(logs.logs).toContain("stored task log coverage");
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

    test("POST /admin/stable-promotion-requests/:stablePromotionRequestID/decide approval adds pending OS release metadata", async () => {
        await RuntimeMetadata.clearOSReleasePendingPackages();

        const approvalOwner = await seedUser("user");
        const approvalPublisher = await seedPublisherWithOwner(approvalOwner.id);
        const approvalPackage = await seedPackageForPublisher(approvalPublisher.id, {
            name: `approved-stable-${randomUUID().slice(0, 8)}`
        });
        const approvalRelease = await seedPackageRelease(approvalPackage.id, {
            version_with_leios_patch: `7.0.${Math.floor(Math.random() * 9000) + 1000}`
        });
        const approvalRequest = await seedStablePromotionRequest(approvalPackage.id, approvalRelease.id, {
            status: "pending"
        });

        await makeAPIRequest(`/v1/admin/stable-promotion-requests/${approvalRequest.id}/decide`, {
            method: "POST",
            authToken: adminSessionToken,
            body: {
                status: "approved",
                admin_note: "Ready for OS release"
            }
        }, 200);

        const pendingPackages = await RuntimeMetadata.getOSReleasePendingPackages();
        expect(pendingPackages.includes(approvalRelease.id)).toBe(true);

        await makeAPIRequest(`/v1/admin/stable-promotion-requests/${approvalRequest.id}/decide`, {
            method: "POST",
            authToken: adminSessionToken,
            body: {
                status: "denied",
                admin_note: "Should not be allowed twice"
            }
        }, 400);
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

describe("Task queue execution coverage", async () => {

    let siteAdmin: SeededUser;
    let siteAdminSessionToken: string;

    beforeAll(async () => {
        siteAdmin = await seedUser("admin");
        siteAdminSessionToken = await seedSession(siteAdmin.id).then(s => s.token);

        await TaskScheduler.processQueue();
    });

    afterAll(async () => {
        await RuntimeMetadata.clearOSReleasePendingPackages();
        await AptlyAPI.Packages.deleteAllInAllRepos("fastfetch").catch(() => null);
        await AptlyAPI.Packages.deleteAllInAllRepos("base-files").catch(() => null);
        await TaskScheduler.stopProcessing();
    });

    test("release upload executes testing-repo:update task to completion", async () => {
        const owner = await seedUser("user");
        const publisher = await seedPublisherWithOwner(owner.id, {
            name: `queue-pub-${randomUUID().slice(0, 8)}`
        });

        const pkg = await seedPackageForPublisher(publisher.id, {
            name: "fastfetch",
            display_name: "Fastfetch Queue Coverage",
            description: "Queue coverage package"
        });

        const release = await seedPackageRelease(pkg.id, {
            version_with_leios_patch: "2.55.0",
            changelog: "Queue coverage release"
        });

        const fileData = new File([
            await Bun.file(TEST_PACKAGE_FIXTURES.fastfetchAmd64).arrayBuffer()
        ], "fastfetch_2.55.0_amd64.deb");
        const formData = new FormData();
        formData.set("file", fileData);

        const taskStartTime = Date.now();

        await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/releases/${release.version_with_leios_patch}/amd64`, {
            method: "POST",
            authToken: siteAdminSessionToken,
            additionalOptions: {
                body: formData
            }
        }, 201);

        const task = await waitForLatestTaskByFunction("testing-repo:update", taskStartTime);

        expect(task.status).toBe("completed");

        const updatedRelease = DB.instance().select().from(DB.Tables.packageReleases).where(
            eq(DB.Tables.packageReleases.id, release.id)
        ).get();
        expect(updatedRelease?.architectures).toEqual({
            amd64: true,
            arm64: false,
            is_all: false
        });

        const updatedPackage = DB.instance().select().from(DB.Tables.packages).where(
            eq(DB.Tables.packages.id, pkg.id)
        ).get();
        expect(updatedPackage?.latest_testing_release).toEqual({
            amd64: "2.55.0",
            arm64: null
        });

        expect(await AptlyAPI.Packages.existsInRepo("leios-testing", "fastfetch", "2.55.0", "amd64")).toBe(true);
    });

    test("os-release route executes async release task to completion", async () => {
        await RuntimeMetadata.clearOSReleasePendingPackages();

        const owner = await seedUser("user");
        const publisher = await seedPublisherWithOwner(owner.id, {
            name: `queue-os-pub-${randomUUID().slice(0, 8)}`
        });

        const pkg = await seedPackageForPublisher(publisher.id, {
            name: "base-files",
            display_name: "Base Files Queue Coverage",
            description: "OS release queue coverage package"
        });

        const release = await seedPackageRelease(pkg.id, {
            version_with_leios_patch: "100.1",
            changelog: "Queue coverage OS release package"
        });

        const fileData = new File([
            await Bun.file(TEST_PACKAGE_FIXTURES.baseFilesAll).arrayBuffer()
        ], "vanilla-os-base-files.deb");
        const formData = new FormData();
        formData.set("file", fileData);

        const uploadTaskStartTime = Date.now();

        await makeAPIRequest(`/v1/packages/${publisher.name}.${pkg.name}/releases/${release.version_with_leios_patch}/all`, {
            method: "POST",
            authToken: siteAdminSessionToken,
            additionalOptions: {
                body: formData
            }
        }, 201);

        const uploadTask = await waitForLatestTaskByFunction("testing-repo:update", uploadTaskStartTime);
        expect(uploadTask.status).toBe("completed");

        await RuntimeMetadata.addOSReleasePendingPackage(release.id);

        const created = await makeAPIRequest("/v1/admin/os-releases", {
            method: "POST",
            authToken: siteAdminSessionToken,
            body: {
                changelog: "Async OS release queue execution test"
            }
        }, 202);

        const osRelease = DB.instance().select().from(DB.Tables.os_releases).where(
            eq(DB.Tables.os_releases.version, created.version)
        ).get();

        expect(osRelease).toBeDefined();
        if (!osRelease) return;

        const task = await waitForTaskById(osRelease.taskID, 20000);
        expect(task.status).toBe("completed");
        expect(task.finished_at).toBeNumber();

        const pendingPackages = await RuntimeMetadata.getOSReleasePendingPackages();
        expect(pendingPackages.includes(release.id)).toBe(false);

        const refreshedPackage = DB.instance().select().from(DB.Tables.packages).where(
            eq(DB.Tables.packages.id, pkg.id)
        ).get();
        expect(refreshedPackage?.latest_stable_release).toEqual({
            amd64: "100.1",
            arm64: "100.1"
        });

        expect(await AptlyAPI.Packages.existsInRepo("leios-stable", "base-files", "100.1", "all")).toBe(true);

        const releaseStatus = await makeAPIRequest(`/v1/admin/os-releases/${created.version}`, {
            authToken: siteAdminSessionToken
        }, 200);
        expect(releaseStatus.publishing_status).toBe("completed");

        const logs = await makeAPIRequest(`/v1/admin/os-releases/${created.version}/publishing-logs`, {
            authToken: siteAdminSessionToken
        }, 200);
        expect(logs.logs).toContain("OS release process completed successfully");
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
