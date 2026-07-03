import fs from "fs/promises";
import path from "path";

const TESTDATA_DIR = path.join(process.cwd(), "testdata");

export const TEST_PACKAGE_FIXTURES = {
    fastfetchAmd64: path.join(TESTDATA_DIR, "fastfetch_2.55.0_amd64.deb"),
    baseFilesAll: path.join(TESTDATA_DIR, "vanilla-os-base-files.deb")
} as const;

type PackageFixture = {
    outputPath: string;
    packageName: string;
    version: string;
    architecture: "amd64" | "all";
    maintainer: string;
    description: string;
    payloadFile: string;
    payloadContents: string;
};

async function runCommand(cmd: string[]) {
    const child = Bun.spawn({
        cmd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
        child.stdout ? new Response(child.stdout).text() : Promise.resolve(""),
        child.stderr ? new Response(child.stderr).text() : Promise.resolve(""),
        child.exited,
    ]);

    if (exitCode !== 0) {
        throw new Error(`Command failed: ${cmd.join(" ")}\n${stderr || stdout}`.trim());
    }
}

async function buildPackage(fixture: PackageFixture) {
    const buildRoot = path.join(TESTDATA_DIR, ".build", path.basename(fixture.outputPath, ".deb"));
    const controlDir = path.join(buildRoot, "DEBIAN");
    const payloadPath = path.join(buildRoot, fixture.payloadFile);

    await fs.rm(buildRoot, { recursive: true, force: true });
    await fs.mkdir(controlDir, { recursive: true });
    await fs.mkdir(path.dirname(payloadPath), { recursive: true });

    await Bun.write(path.join(controlDir, "control"), [
        `Package: ${fixture.packageName}`,
        `Version: ${fixture.version}`,
        `Architecture: ${fixture.architecture}`,
        `Maintainer: ${fixture.maintainer}`,
        `Description: ${fixture.description}`,
        "",
    ].join("\n"));
    await Bun.write(payloadPath, fixture.payloadContents);

    // Force gzip compression for Aptly compatibility across environments.
    await runCommand(["dpkg-deb", "-Zgzip", "--build", buildRoot, fixture.outputPath]);
    await fs.rm(buildRoot, { recursive: true, force: true });
}

export async function ensureTestPackageFixtures() {
    await fs.mkdir(TESTDATA_DIR, { recursive: true });

    await Promise.all([
        buildPackage({
            outputPath: TEST_PACKAGE_FIXTURES.fastfetchAmd64,
            packageName: "fastfetch",
            version: "2.55.0",
            architecture: "amd64",
            maintainer: "Carter Li <zhangsongcui@live.cn>",
            description: "Fastfetch test fixture package",
            payloadFile: "usr/share/doc/fastfetch/README",
            payloadContents: "fastfetch fixture\n"
        }),
        buildPackage({
            outputPath: TEST_PACKAGE_FIXTURES.baseFilesAll,
            packageName: "base-files",
            version: "100.1",
            architecture: "all",
            maintainer: "Santiago Vila <sanvila@debian.org>",
            description: "Base files test fixture package",
            payloadFile: "usr/share/base-files/release-info.txt",
            payloadContents: "base-files fixture\n"
        })
    ]);
}
