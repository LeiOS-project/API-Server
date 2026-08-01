import fs from "fs/promises";
import path from "path";

const PACKAGE_NAME = "leios.system.branding-meta-files";

/**
 * Ensures an isolated branding-meta-files repository is available for tests.
 *
 * When the real System-Packages/branding-meta-files checkout exists, it is
 * copied into a temp directory so concurrent test runs do not race on the
 * shared source directory. When the real checkout is unavailable (e.g. in CI),
 * a minimal self-contained fixture repo is created instead.
 *
 * @param preferredRepoPath - Path to the real branding repo.
 * @param parentDir - Directory under which the isolated repo should be
 *   created. This should be the test session's temp root so everything is
 *   cleaned up together.
 * @returns The path to use as LRA_BRANDING_META_REPO.
 */
export async function ensureBrandingFixtureRepo(preferredRepoPath: string, parentDir: string): Promise<string> {
    const repoExists = await fs.access(preferredRepoPath).then(() => true).catch(() => false);

    const root = path.join(parentDir, "branding-meta-files");

    if (repoExists) {
        // Copy the real repo into an isolated temp directory to avoid races
        // when multiple test files build branding packages concurrently.
        await fs.cp(preferredRepoPath, root, { recursive: true, force: true });
        return root;
    }

    const scriptsDir = path.join(root, "scripts");
    const debBuildDir = path.join(root, "deb-build");

    await fs.mkdir(scriptsDir, { recursive: true });
    await fs.mkdir(debBuildDir, { recursive: true });

    // Minimal build script that dpkg-deb can use to produce a valid .deb.
    // Shell variables (${VERSION}, ${DIST}, ${3:-}) are escaped so they are
    // expanded at shell runtime; the package name is interpolated now since it
    // is a TS constant.
    await Bun.write(path.join(scriptsDir, "build.sh"), `#!/bin/bash
set -e

DIST="$1"
VERSION="$2"
CHANGELOG_LINES="\${3:-}"

PACKAGE_NAME="${PACKAGE_NAME}"
BUILD_DIR=$(mktemp -d)

mkdir -p "$BUILD_DIR/DEBIAN"
mkdir -p "$BUILD_DIR/etc/leios/system"

cat > "$BUILD_DIR/DEBIAN/control" <<EOF
Package: ${PACKAGE_NAME}
Version: \${VERSION}
Architecture: all
Maintainer: LeiOS Project Team <support@leios.dev>
Description: Metadata files for LeiOS branding
EOF

echo "\${VERSION}" > "$BUILD_DIR/etc/leios/system/version"
printf 'leios.system.branding-meta-files (%s) %s; urgency=medium\n\n  * Test fixture build\n -- LeiOS Project Team <support@leios.dev>  %s\n' "\${VERSION}" "\${DIST}" "$(date -R)" > "$BUILD_DIR/etc/leios/system/changelog"

mkdir -p deb-build
dpkg-deb -Zgzip --build "$BUILD_DIR" "deb-build/${PACKAGE_NAME}_\${VERSION}_all.deb"
rm -rf "$BUILD_DIR"
`);

    return root;
}
