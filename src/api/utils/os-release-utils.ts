import { Logger } from "../../utils/logger";

export class OSReleaseUtils {
	static getVersionString(date: Date, lastRelease = "0000.00.000") {
		const year = date.getUTCFullYear();
		const month = String(date.getUTCMonth() + 1).padStart(2, "0");

		let releaseNumberThisMonth = 1;
		if (lastRelease.startsWith(`${year}.${month}.`)) {
			const lastReleaseParts = lastRelease.split(".") as [string, string, string];

			if (lastReleaseParts.length !== 3) {
				Logger.error("Invalid last release format:", lastRelease);
				return `${year}.${month}.${String(releaseNumberThisMonth)}`;
			}

			const lastReleaseNumberThisMonth = parseInt(lastReleaseParts[2], 10);
			releaseNumberThisMonth = lastReleaseNumberThisMonth + 1;
		}

		return `${year}.${month}.${String(releaseNumberThisMonth).padStart(3, "0")}`;
	}

	/**
	 * Release notes for an OS release in Markdown, like GitHub's generated release notes: one line
	 * per package release with the version it replaces in stable and the first line of its
	 * changelog. `hubURL` links the package names to their Hub pages.
	 */
	static generateChangelog(entries: OSReleaseUtils.ChangelogEntry[], hubURL?: string): string {
		if (entries.length === 0) {
			return "This release contains no package updates.";
		}

		const line = (entry: OSReleaseUtils.ChangelogEntry) => {
			const name = hubURL
				? `[**${entry.package_display_name}**](${hubURL}/explore/${entry.package_fullname})`
				: `**${entry.package_display_name}**`;
			const version = entry.previous_stable_version
				? `${entry.previous_stable_version} → ${entry.package_release_version}`
				: entry.package_release_version;
			const summary = OSReleaseUtils.summarize(entry.release_changelog);
			return `- ${name} (\`${entry.package_fullname}\`) ${version}${summary ? `: ${summary}` : ""}`;
		};

		const updated = entries.filter((entry) => entry.previous_stable_version !== null);
		const added = entries.filter((entry) => entry.previous_stable_version === null);
		const count = (n: number, singular: string, plural: string) =>
			`${n} ${n === 1 ? singular : plural}`;

		const intro = [
			updated.length > 0 ? count(updated.length, "package update", "package updates") : null,
			added.length > 0 ? count(added.length, "new package", "new packages") : null,
		]
			.filter(Boolean)
			.join(" and ");

		const sections = [`This release brings ${intro} to stable.`];
		if (updated.length > 0) {
			sections.push(["### Updated packages", "", ...updated.map(line)].join("\n"));
		}
		if (added.length > 0) {
			sections.push(["### New packages", "", ...added.map(line)].join("\n"));
		}
		return sections.join("\n\n");
	}

	/**
	 * A Markdown changelog as plain lines for the Debian changelog of the branding package:
	 * headings, list markers, emphasis and link targets removed, empty lines dropped.
	 */
	static toPlainLines(markdown: string): string[] {
		const lines: string[] = [];
		let inCodeBlock = false;

		for (const raw of markdown.split("\n")) {
			const line = raw.trim();
			if (/^(```|~~~)/.test(line)) {
				inCodeBlock = !inCodeBlock;
				continue;
			}
			if (inCodeBlock) {
				if (line) lines.push(line);
				continue;
			}
			// thematic breaks (---, ***) and HTML comments
			if (/^([-*_]\s*){3,}$/.test(line) || /^<!--.*-->$/.test(line)) continue;

			const text = OSReleaseUtils.inlineToPlain(
				line.replace(/^(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, ""),
			);
			if (text) lines.push(text);
		}

		return lines;
	}

	/** First line of a Markdown changelog as plain text, at most `maxLength` characters. */
	static summarize(markdown: string, maxLength = 160): string {
		const first = OSReleaseUtils.toPlainLines(markdown)[0] ?? "";
		return first.length > maxLength ? `${first.slice(0, maxLength - 1).trimEnd()}…` : first;
	}

	protected static inlineToPlain(text: string): string {
		return (
			text
				.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt text
				.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → link text
				.replace(/(\*\*|__|~~)(.+?)\1/g, "$2") // bold, strikethrough
				// italics with `*` only: `_` is common in package names
				.replace(/\*(\S(?:.*?\S)?)\*/g, "$1")
				.replace(/`([^`]*)`/g, "$1")
				.replace(/<[^>]+>/g, "")
				.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1")
				.trim()
		);
	}
}

export namespace OSReleaseUtils {
	export interface ChangelogEntry {
		package_fullname: string;
		package_display_name: string;
		package_release_version: string;
		/** The version in stable before this OS release; null for a package new to stable. */
		previous_stable_version: string | null;
		/** The package release's own changelog (Markdown). */
		release_changelog: string;
	}
}
