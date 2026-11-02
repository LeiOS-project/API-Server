import { describe, expect, test } from "bun:test";
import { OSReleaseUtils } from "../src/api/utils/os-release-utils";

const entry = (
	overrides: Partial<OSReleaseUtils.ChangelogEntry>,
): OSReleaseUtils.ChangelogEntry => ({
	package_fullname: "mozilla.firefox",
	package_display_name: "Firefox",
	package_release_version: "129.0leios1",
	previous_stable_version: "128.0leios1",
	release_changelog:
		"## Changes\n\n- Fixes **CVE-2026-1234** in the [PDF viewer](https://example.com)",
	...overrides,
});

describe("OSReleaseUtils.generateChangelog", () => {
	test("groups updated and new packages and links them to the Hub", () => {
		const changelog = OSReleaseUtils.generateChangelog(
			[
				entry({}),
				entry({
					package_fullname: "leios.tools_extra",
					package_display_name: "Tools",
					package_release_version: "1.0.0",
					previous_stable_version: null,
					release_changelog: "Initial release",
				}),
			],
			"https://hub.leios.dev",
		);

		expect(changelog).toBe(
			[
				"This release brings 1 package update and 1 new package to stable.",
				"",
				"### Updated packages",
				"",
				"- [**Firefox**](https://hub.leios.dev/explore/mozilla.firefox) (`mozilla.firefox`) 128.0leios1 → 129.0leios1: Changes",
				"",
				"### New packages",
				"",
				"- [**Tools**](https://hub.leios.dev/explore/leios.tools_extra) (`leios.tools_extra`) 1.0.0: Initial release",
			].join("\n"),
		);
	});

	test("says so when nothing is included", () => {
		expect(OSReleaseUtils.generateChangelog([])).toBe("This release contains no package updates.");
	});

	test("counts in plural and works without a Hub URL", () => {
		const changelog = OSReleaseUtils.generateChangelog([entry({}), entry({ release_changelog: "" })]);
		expect(changelog.split("\n")[0]).toBe("This release brings 2 package updates to stable.");
		expect(changelog.endsWith("\n- **Firefox** (`mozilla.firefox`) 128.0leios1 → 129.0leios1")).toBe(
			true,
		);
	});
});

describe("OSReleaseUtils.toPlainLines", () => {
	test("strips Markdown for the Debian changelog", () => {
		expect(
			OSReleaseUtils.toPlainLines(
				[
					"## Security fixes",
					"",
					"- Fixes **CVE-2026-1234** in `libfoo` ([details](https://example.com))",
					"1. *First* ~~old~~ step",
					"> quoted_name stays",
					"---",
					"```",
					"code line",
					"```",
					"<!-- hidden -->",
				].join("\n"),
			),
		).toEqual([
			"Security fixes",
			"Fixes CVE-2026-1234 in libfoo (details)",
			"First old step",
			"quoted_name stays",
			"code line",
		]);
	});

	test("summarize keeps the first line and shortens it", () => {
		expect(OSReleaseUtils.summarize("\n\n# Title\nmore")).toBe("Title");
		expect(OSReleaseUtils.summarize("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
	});
});
