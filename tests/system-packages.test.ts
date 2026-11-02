import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { DB } from "../src/db";
import { BrandingBuilder } from "../src/utils/branding-builder";
import { SystemPackages } from "../src/utils/system-packages";
import { makeAPIRequest } from "./helpers/api";
import { seedPackageRelease, seedSession, seedUser } from "./helpers/seed";

const fullname = SystemPackages.BRANDING_META_FILES_FULLNAME;

function brandingPackage() {
	const pkg = DB.instance()
		.select()
		.from(DB.Tables.packagesFullView)
		.where(eq(DB.Tables.packagesFullView.fullname, fullname))
		.get();
	if (!pkg) throw new Error(`${fullname} is missing`);
	return pkg;
}

describe("System packages", () => {
	let adminToken: string;
	let releaseVersion: string;

	beforeAll(async () => {
		adminToken = await seedSession((await seedUser("admin")).id);

		const release = await seedPackageRelease(brandingPackage().id, {
			version_with_leios_patch: "2000.01.001",
			architectures: { amd64: true, arm64: true, is_all: true },
		});
		releaseVersion = release.version_with_leios_patch;
	});

	test("the branding package exists from the start and is system-managed", async () => {
		const pkg = await makeAPIRequest(`/v1/packages/${fullname}`, {}, 200);
		expect(pkg.flags).toEqual(["SYSTEM-MANAGED"]);
		expect(pkg.display_name).toBe(SystemPackages.BRANDING_META_FILES.display_name);

		const releases = await makeAPIRequest(`/v1/packages/${fullname}/releases`, {}, 200);
		expect(releases.map((release: any) => release.version_with_leios_patch)).toContain(
			releaseVersion,
		);
	});

	test("nobody can change it through the API, not even an admin", async () => {
		const base = `/v1/packages/${fullname}`;
		const release = `${base}/releases/${releaseVersion}`;
		const attempts: [string, "POST" | "PUT" | "DELETE", Record<string, unknown>?][] = [
			[base, "PUT", { display_name: "Renamed" }],
			[base, "DELETE"],
			[`${base}/releases`, "POST", { version_with_leios_patch: "2000.01.002", changelog: "x" }],
			[release, "PUT", { changelog: "Edited" }],
			[release, "DELETE"],
			[`${release}/stable-promotion-requests`, "POST", {}],
			[`${base}/role-assignments`, "POST", { user_id: 1, role: "VIEWER" }],
		];

		for (const [path, method, body] of attempts) {
			await makeAPIRequest(path, { method, authToken: adminToken, body }, 403);
		}

		await makeAPIRequest(
			`/v1/admin/packages/${fullname}/moderation`,
			{ method: "PUT", authToken: adminToken, body: { hidden: true, deprecated: false, note: null } },
			403,
		);

		const pkg = brandingPackage();
		expect(pkg.display_name).toBe(SystemPackages.BRANDING_META_FILES.display_name);
		expect(pkg.flags).toEqual(["SYSTEM-MANAGED"]);
	});

	test("published builds show up as its testing and stable versions", async () => {
		await BrandingBuilder.recordPublishedBuild({
			distribution: "testing",
			version: "20990101120000",
		});
		expect(brandingPackage().latest_testing_release).toEqual({
			amd64: "20990101120000",
			arm64: "20990101120000",
		});

		const notes = "## LeiOS 2099.01.001\n\n- Something new";
		await BrandingBuilder.recordPublishedBuild({
			distribution: "stable",
			version: "2099.01.001",
			changelog: notes,
		});
		// Recording the same build again (a resumed task) updates instead of failing.
		await BrandingBuilder.recordPublishedBuild({
			distribution: "stable",
			version: "2099.01.001",
			changelog: notes,
		});

		const pkg = brandingPackage();
		expect(pkg.latest_stable_release).toEqual({ amd64: "2099.01.001", arm64: "2099.01.001" });

		const releases = await makeAPIRequest(`/v1/packages/${fullname}/releases`, {}, 200);
		const stable = releases.filter(
			(release: any) => release.version_with_leios_patch === "2099.01.001",
		);
		expect(stable).toHaveLength(1);
		expect(stable[0]).toMatchObject({
			changelog: notes,
			architectures: { amd64: true, arm64: true, is_all: true },
		});
	});
});
