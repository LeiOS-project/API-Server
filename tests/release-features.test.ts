import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { API } from "../src/api";
import { AuthHandler } from "../src/api/utils/authHandler";
import { type CapturedEmail, EmailService } from "../src/api/utils/email";
import { DB } from "../src/db";
import { PermissionHelper } from "../src/utils/permission-helper";
import { makeAPIRequest } from "./helpers/api";
import { createMemoryTransport } from "./helpers/memory-transport";
import {
	type SeededUser,
	seedMembership,
	seedPackage,
	seedPackageRelease,
	seedPublisher,
	seedSession,
	seedUser,
} from "./helpers/seed";

const capturedEmails: CapturedEmail[] = [];

/** The last `token=` value emailed to `to`. */
function lastTokenSentTo(to: string) {
	const email = capturedEmails.filter((mail) => mail.to === to).at(-1);
	const token = email?.html.match(/token=([0-9a-f]+)/)?.[1];
	if (!token) throw new Error(`No token emailed to ${to}`);
	return token;
}

function uniqueName(prefix: string) {
	return `${prefix}${randomUUID().slice(0, 8)}`;
}

let admin: SeededUser;
let adminToken: string;

beforeAll(async () => {
	EmailService.init(createMemoryTransport(capturedEmails));

	admin = await seedUser("admin");
	adminToken = await seedSession(admin.id);
});

afterAll(() => {
	EmailService.reset();
});

describe("Meta", () => {
	test("GET /meta reports signup and email as enabled", async () => {
		const meta = await makeAPIRequest("/v1/meta");
		expect(meta).toEqual({ signup_enabled: true, email_enabled: true });
	});

	test("GET /meta reports signup as disabled while email is off", async () => {
		EmailService.reset();
		try {
			const meta = await makeAPIRequest("/v1/meta");
			expect(meta.signup_enabled).toBe(false);

			await makeAPIRequest(
				"/v1/auth/signup",
				{
					method: "POST",
					body: {
						username: uniqueName("nomail"),
						display_name: "No Mail",
						email: `${randomUUID()}@example.com`,
						password: "Str0ng!Pass",
					},
				},
				403,
			);
		} finally {
			EmailService.init(createMemoryTransport(capturedEmails));
		}
	});

	test("GET /meta/stats returns public counts", async () => {
		const stats = await makeAPIRequest("/v1/meta/stats");
		expect(stats.packages).toBeNumber();
		expect(stats.publishers).toBeGreaterThan(0);
		expect(stats).toHaveProperty("latest_os_release");
	});

	test("GET /os-releases lists only published releases", async () => {
		const list = await makeAPIRequest("/v1/os-releases");
		expect(Array.isArray(list.items)).toBe(true);
		expect(list.total).toBe(list.items.length);
	});
});

describe("Signup and email verification", () => {
	const username = uniqueName("signup");
	const email = `${randomUUID()}@example.com`;
	const password = "Str0ng!Pass";
	let userID: number;
	let sessionToken: string;

	test("POST /auth/signup creates an unconfirmed account and emails a link", async () => {
		const created = await makeAPIRequest(
			"/v1/auth/signup",
			{
				method: "POST",
				body: { username, display_name: "Signup User", email, password },
			},
			201,
		);

		userID = created.id;
		expect(created.email_verified_at).toBeNull();
		expect(lastTokenSentTo(email)).toBeString();
	});

	test("POST /auth/signup rejects a taken username or email", async () => {
		await makeAPIRequest(
			"/v1/auth/signup",
			{
				method: "POST",
				body: { username, display_name: "Dup", email: `${randomUUID()}@example.com`, password },
			},
			409,
		);
		await makeAPIRequest(
			"/v1/auth/signup",
			{
				method: "POST",
				body: { username: uniqueName("other"), display_name: "Dup", email, password },
			},
			409,
		);
	});

	test("POST /auth/signup rejects a weak password", async () => {
		await makeAPIRequest(
			"/v1/auth/signup",
			{
				method: "POST",
				body: {
					username: uniqueName("weak"),
					display_name: "Weak",
					email: `${randomUUID()}@example.com`,
					password: "password",
				},
			},
			400,
		);
	});

	test("an unconfirmed account can sign in but cannot create a publisher", async () => {
		const session = await makeAPIRequest("/v1/auth/login", {
			method: "POST",
			body: { username, password },
		});
		sessionToken = session.token;

		await makeAPIRequest(
			"/v1/publishers",
			{
				method: "POST",
				authToken: sessionToken,
				body: {
					name: uniqueName("unv-"),
					display_name: "Unverified",
					description: "x",
					homepage_url: "https://example.com",
					maintainer_contact_name: "X",
					maintainer_contact_email: "x@example.com",
				},
			},
			403,
		);
	});

	test("POST /auth/signup is refused for signed-in callers", async () => {
		await makeAPIRequest(
			"/v1/auth/signup",
			{
				method: "POST",
				authToken: sessionToken,
				body: {
					username: uniqueName("again"),
					display_name: "Again",
					email: `${randomUUID()}@example.com`,
					password,
				},
			},
			403,
		);
	});

	test("POST /auth/verify-email rejects an unknown token", async () => {
		await makeAPIRequest(
			"/v1/auth/verify-email",
			{ method: "POST", body: { token: "deadbeef" } },
			400,
		);
	});

	test("POST /auth/verify-email/resend answers the same for unknown addresses", async () => {
		const before = capturedEmails.length;
		await makeAPIRequest("/v1/auth/verify-email/resend", {
			method: "POST",
			body: { email: `${randomUUID()}@example.com` },
		});
		expect(capturedEmails.length).toBe(before);
	});

	test("POST /auth/verify-email confirms the address and unlocks publishers", async () => {
		await makeAPIRequest("/v1/auth/verify-email", {
			method: "POST",
			body: { token: lastTokenSentTo(email) },
		});

		const account = await makeAPIRequest("/v1/account", { authToken: sessionToken });
		expect(account.email_verified_at).toBeNumber();

		await makeAPIRequest(
			"/v1/publishers",
			{
				method: "POST",
				authToken: sessionToken,
				body: {
					name: uniqueName("ver-"),
					display_name: "Verified",
					description: "x",
					homepage_url: "https://example.com",
					maintainer_contact_name: "X",
					maintainer_contact_email: "x@example.com",
				},
			},
			201,
		);
	});

	test("the token is single-use", async () => {
		const verification = DB.instance()
			.select()
			.from(DB.Tables.emailVerifications)
			.where(eq(DB.Tables.emailVerifications.user_id, userID))
			.get();
		expect(verification).toBeUndefined();
	});

	test("changing the email requires confirming the new address", async () => {
		const newEmail = `${randomUUID()}@example.com`;

		await makeAPIRequest("/v1/account", {
			method: "PUT",
			authToken: sessionToken,
			body: { email: newEmail, current_password: password },
		});

		const account = await makeAPIRequest("/v1/account", { authToken: sessionToken });
		expect(account.email).toBe(newEmail);
		expect(account.email_verified_at).toBeNull();

		await makeAPIRequest("/v1/auth/verify-email", {
			method: "POST",
			body: { token: lastTokenSentTo(newEmail) },
		});

		const confirmed = await makeAPIRequest("/v1/account", { authToken: sessionToken });
		expect(confirmed.email_verified_at).toBeNumber();
	});

	test("POST /account/email-verification refuses an already confirmed address", async () => {
		await makeAPIRequest(
			"/v1/account/email-verification",
			{ method: "POST", authToken: sessionToken },
			409,
		);
	});

	test("PUT /account ignores server-managed fields", async () => {
		await makeAPIRequest("/v1/account", {
			method: "PUT",
			authToken: sessionToken,
			body: {
				display_name: "Renamed",
				status: "suspended",
				email_verified_at: null,
				role: "admin",
				current_password: password,
			},
		});

		const user = DB.instance()
			.select()
			.from(DB.Tables.users)
			.where(eq(DB.Tables.users.id, userID))
			.get();
		expect(user?.display_name).toBe("Renamed");
		expect(user?.status).toBe("active");
		expect(user?.role).toBe("user");
		expect(user?.email_verified_at).toBeNumber();
	});

	test("a wrong current password is a 403, not a 401", async () => {
		await makeAPIRequest(
			"/v1/account",
			{
				method: "PUT",
				authToken: sessionToken,
				body: { display_name: "Nope", current_password: "Wr0ng!Pass" },
			},
			403,
		);
	});
});

describe("Admin user moderation", () => {
	let target: SeededUser;
	let targetToken: string;

	beforeAll(async () => {
		target = await seedUser("user");
		targetToken = await seedSession(target.id);
	});

	test("non-admins cannot suspend users", async () => {
		await makeAPIRequest(
			`/v1/admin/users/${admin.id}/suspend`,
			{ method: "POST", authToken: targetToken, body: { reason: "nope" } },
			403,
		);
	});

	test("admins cannot suspend themselves", async () => {
		await makeAPIRequest(
			`/v1/admin/users/${admin.id}/suspend`,
			{ method: "POST", authToken: adminToken, body: { reason: "self" } },
			409,
		);
	});

	test("suspending ends sessions and blocks sign-in", async () => {
		await makeAPIRequest(`/v1/admin/users/${target.id}/suspend`, {
			method: "POST",
			authToken: adminToken,
			body: { reason: "Spam" },
		});

		await makeAPIRequest("/v1/account", { authToken: targetToken }, 401);

		const res = await API.getApp().request("/v1/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: target.username, password: target.password }),
		});
		expect(res.status).toBe(403);
		expect(((await res.json()) as any).message).toBe("This account is suspended");

		const list = await makeAPIRequest("/v1/admin/users?status=suspended&limit=100", {
			authToken: adminToken,
		});
		expect(list.items.some((user: any) => user.id === target.id)).toBe(true);
	});

	test("lifting the suspension allows sign-in again", async () => {
		await makeAPIRequest(`/v1/admin/users/${target.id}/unsuspend`, {
			method: "POST",
			authToken: adminToken,
		});

		const session = await makeAPIRequest("/v1/auth/login", {
			method: "POST",
			body: { username: target.username, password: target.password },
		});
		targetToken = session.token;
	});

	test("revoke-sessions signs the user out everywhere", async () => {
		await makeAPIRequest(`/v1/admin/users/${target.id}/revoke-sessions`, {
			method: "POST",
			authToken: adminToken,
		});

		expect(await AuthHandler.getAuthContext(targetToken)).toBeNull();
	});

	test("password-reset-link returns a working link", async () => {
		const link = await makeAPIRequest(
			`/v1/admin/users/${target.id}/password-reset-link`,
			{ method: "POST", authToken: adminToken, body: {} },
			201,
		);
		expect(link.emailed).toBe(false);

		const token = new URL(link.reset_url).searchParams.get("token");
		await makeAPIRequest("/v1/auth/reset-password", {
			method: "POST",
			body: { reset_token: token, new_password: "N3w!Password" },
		});

		await makeAPIRequest("/v1/auth/login", {
			method: "POST",
			body: { username: target.username, password: "N3w!Password" },
		});
	});

	test("verify-email confirms an address on the user's behalf", async () => {
		const unverified = await seedUser("user", { email_verified_at: null });

		await makeAPIRequest(`/v1/admin/users/${unverified.id}/verify-email`, {
			method: "POST",
			authToken: adminToken,
		});
		await makeAPIRequest(
			`/v1/admin/users/${unverified.id}/verify-email`,
			{ method: "POST", authToken: adminToken },
			409,
		);
	});

	test("GET /admin/users/:userId/publishers lists memberships", async () => {
		const publisher = await seedPublisher(target.id);

		const memberships = await makeAPIRequest(`/v1/admin/users/${target.id}/publishers`, {
			authToken: adminToken,
		});
		const membership = memberships.find((entry: any) => entry.id === publisher.id);
		expect(membership).toMatchObject({ role: "ADMIN", is_owner: true });
	});

	test("the audit log records the moderation actions", async () => {
		const log = await makeAPIRequest(
			`/v1/admin/audit-log?target_type=user&target_id=${target.id}&action=user.&limit=100`,
			{ authToken: adminToken },
		);

		const actions = log.items.map((entry: any) => entry.action);
		expect(actions).toEqual(
			expect.arrayContaining([
				"user.suspend",
				"user.unsuspend",
				"user.sessions_revoke",
				"user.password_reset_link",
			]),
		);
		expect(log.items.every((entry: any) => entry.actor_username === admin.username)).toBe(true);
	});
});

describe("Publisher verification and package moderation", () => {
	let owner: SeededUser;
	let ownerToken: string;
	let publisher: DB.Models.Publisher;
	let pkg: DB.Models.Package;
	let fullname: string;

	beforeAll(async () => {
		owner = await seedUser("user");
		ownerToken = await seedSession(owner.id);
		publisher = await seedPublisher(owner.id);
		pkg = await seedPackage(publisher.id);
		fullname = `${publisher.name}.${pkg.name}`;
	});

	test("admins can verify a publisher", async () => {
		await makeAPIRequest(`/v1/admin/publishers/${publisher.name}/verify`, {
			method: "POST",
			authToken: adminToken,
		});

		const details = await makeAPIRequest(`/v1/publishers/${publisher.name}`);
		expect(details.verified_at).toBeNumber();

		const pkgDetails = await makeAPIRequest(`/v1/packages/${fullname}`);
		expect(pkgDetails.publisher_verified_at).toBeNumber();
		expect(pkgDetails.publisher_display_name).toBe(publisher.display_name);

		const list = await makeAPIRequest(`/v1/admin/publishers?search=${publisher.name}&verified=true`, {
			authToken: adminToken,
		});
		expect(list.items[0]).toMatchObject({ name: publisher.name, package_count: 1, member_count: 1 });
	});

	test("hidden packages disappear for the public but stay visible to members and admins", async () => {
		await makeAPIRequest(`/v1/admin/packages/${fullname}/moderation`, {
			method: "PUT",
			authToken: adminToken,
			body: { hidden: true, deprecated: false, note: "Under review" },
		});

		await makeAPIRequest(`/v1/packages/${fullname}`, {}, 404);
		await makeAPIRequest(`/v1/packages/${fullname}/releases`, {}, 404);

		const publicList = await makeAPIRequest(`/v1/packages?publisherID=${publisher.id}`);
		expect(publicList.total).toBe(0);

		const ownerView = await makeAPIRequest(`/v1/packages/${fullname}`, { authToken: ownerToken });
		expect(ownerView.flags).toContain("HIDDEN");
		expect(ownerView.moderation_note).toBe("Under review");

		const memberList = await makeAPIRequest("/v1/packages?onlyMembershipByMe=true&limit=100", {
			authToken: ownerToken,
		});
		expect(memberList.items.some((item: any) => item.id === pkg.id)).toBe(true);

		const adminList = await makeAPIRequest(`/v1/packages?flag=HIDDEN&limit=100`, {
			authToken: adminToken,
		});
		expect(adminList.items.some((item: any) => item.id === pkg.id)).toBe(true);
	});

	test("deprecated packages stay listed with the flag", async () => {
		await makeAPIRequest(`/v1/admin/packages/${fullname}/moderation`, {
			method: "PUT",
			authToken: adminToken,
			body: { hidden: false, deprecated: true, note: "Use something else" },
		});

		const list = await makeAPIRequest(`/v1/packages?publisherID=${publisher.id}&flag=DEPRECATED`);
		expect(list.items.map((item: any) => item.id)).toEqual([pkg.id]);
	});

	test("system-managed packages cannot be moderated", async () => {
		const systemPackage = await seedPackage(publisher.id);
		DB.instance()
			.update(DB.Tables.packages)
			.set({ flags: ["SYSTEM-MANAGED"] })
			.where(eq(DB.Tables.packages.id, systemPackage.id))
			.run();

		await makeAPIRequest(
			`/v1/admin/packages/${publisher.name}.${systemPackage.name}/moderation`,
			{
				method: "PUT",
				authToken: adminToken,
				body: { hidden: true, deprecated: false, note: null },
			},
			403,
		);
	});

	test("sort=updated puts the most recently released package first", async () => {
		const older = await seedPackage(publisher.id);
		const newer = await seedPackage(publisher.id);
		await seedPackageRelease(older.id, { version_with_leios_patch: "1.0.0" });
		const release = await seedPackageRelease(newer.id, { version_with_leios_patch: "1.0.0" });
		DB.instance()
			.update(DB.Tables.packageReleases)
			.set({ created_at: Date.now() + 60_000 })
			.where(eq(DB.Tables.packageReleases.id, release.id))
			.run();

		const list = await makeAPIRequest(`/v1/packages?publisherID=${publisher.id}&sort=updated`);
		expect(list.items[0].id).toBe(newer.id);
		expect(list.items[0].last_release_at).toBeNumber();
	});

	test("channel=testing only lists packages with a testing version", async () => {
		const inTesting = await seedPackage(publisher.id);
		DB.instance()
			.update(DB.Tables.packages)
			.set({ latest_testing_release: { amd64: "2.0.0", arm64: null } })
			.where(eq(DB.Tables.packages.id, inTesting.id))
			.run();

		const list = await makeAPIRequest(`/v1/packages?publisherID=${publisher.id}&channel=testing`);
		expect(list.items.map((item: any) => item.id)).toEqual([inTesting.id]);
	});
});

describe("Reports", () => {
	let reporter: SeededUser;
	let reporterToken: string;
	let publisher: DB.Models.Publisher;
	let reportID: number;

	beforeAll(async () => {
		reporter = await seedUser("user");
		reporterToken = await seedSession(reporter.id);

		const owner = await seedUser("user");
		publisher = await seedPublisher(owner.id);
		await seedMembership(publisher.id, reporter.id, PermissionHelper.OrgRoles.VIEWER);
	});

	test("reporting needs a confirmed email address", async () => {
		const unverified = await seedUser("user", { email_verified_at: null });
		const token = await seedSession(unverified.id);

		await makeAPIRequest(
			"/v1/reports",
			{
				method: "POST",
				authToken: token,
				body: { target_type: "publisher", target_name: publisher.name, reason: "spam" },
			},
			403,
		);
	});

	test("reporting an unknown target is a 404", async () => {
		await makeAPIRequest(
			"/v1/reports",
			{
				method: "POST",
				authToken: reporterToken,
				body: { target_type: "package", target_name: "nobody.nothing", reason: "spam" },
			},
			404,
		);
	});

	test("POST /reports files a report that admins can resolve once", async () => {
		const created = await makeAPIRequest(
			"/v1/reports",
			{
				method: "POST",
				authToken: reporterToken,
				body: {
					target_type: "publisher",
					target_name: publisher.name,
					reason: "impersonation",
					details: "Pretends to be the LeiOS team",
				},
			},
			201,
		);
		reportID = created.id;

		const open = await makeAPIRequest("/v1/admin/reports?status=open&limit=100", {
			authToken: adminToken,
		});
		const report = open.items.find((item: any) => item.id === reportID);
		expect(report).toMatchObject({
			target_label: publisher.name,
			reporter_username: reporter.username,
			status: "open",
		});

		await makeAPIRequest(`/v1/admin/reports/${reportID}/resolve`, {
			method: "POST",
			authToken: adminToken,
			body: { status: "dismissed", note: "Legit publisher" },
		});

		await makeAPIRequest(
			`/v1/admin/reports/${reportID}/resolve`,
			{ method: "POST", authToken: adminToken, body: { status: "resolved" } },
			409,
		);

		const closed = await makeAPIRequest(`/v1/admin/reports/${reportID}`, { authToken: adminToken });
		expect(closed).toMatchObject({ status: "dismissed", resolved_by_username: admin.username });
	});

	test("GET /admin/stats counts the open work", async () => {
		const stats = await makeAPIRequest("/v1/admin/stats", { authToken: adminToken });
		expect(stats.users.total).toBeGreaterThan(0);
		expect(stats.reports_open).toBeNumber();
		expect(stats.tasks).toHaveProperty("failed");
	});

	test("admin endpoints stay admin-only", async () => {
		await makeAPIRequest("/v1/admin/stats", { authToken: reporterToken }, 403);
		await makeAPIRequest("/v1/admin/reports", {}, 401);
	});
});
