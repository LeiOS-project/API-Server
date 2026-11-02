/**
 * Packages the API builds and publishes itself. They exist in the database so the Hub lists them,
 * carry the `SYSTEM-MANAGED` flag and are read-only through the API: the package-loading
 * middleware refuses every write to them, for everyone including admins.
 */
export namespace SystemPackages {
	/** Publisher that owns the system packages (created on first start, see `DB.init`). */
	export const PUBLISHER_NAME = "leios";

	/**
	 * Branding and release information of LeiOS. The testing-repo update builds a new testing
	 * version of it every time, and every OS release builds the stable version named after it.
	 */
	export const BRANDING_META_FILES = {
		name: "system.branding-meta-files",
		display_name: "LeiOS Branding & Release Info",
		description: [
			"Branding and release information of LeiOS: the files that tell an installed system which LeiOS release it runs.",
			"",
			"The LeiOS Hub builds this package itself: a new **testing** version with every update of the testing repository, and a **stable** version, named after the release, with every LeiOS release. It cannot be changed by hand.",
		].join("\n"),
		homepage_url: "https://git.leicraftmc.de/LeiOS/System-Packages/Branding-Meta-Files",
	} as const;

	export const BRANDING_META_FILES_FULLNAME = `${PUBLISHER_NAME}.${BRANDING_META_FILES.name}`;

	export const ALL = [BRANDING_META_FILES] as const;
}
