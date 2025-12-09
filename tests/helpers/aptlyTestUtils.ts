import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { AptlyAPIServer, AptlyAPISettings } from "../../src/aptly/server";
import { AptlyAPI } from "../../src/aptly/api";
import { AptlyUtils } from "../../src/aptly/utils";

const FIXTURE_APTLY_BIN = path.resolve(process.env.APTLY_TEST_BIN ?? "./data/aptly/bin/aptly");
const FIXTURE_KEYS_DIR = path.resolve(process.env.APTLY_TEST_KEYS_DIR ?? "./data/keys");
const FIXTURE_DEB = path.resolve(process.env.APTLY_TEST_DEB ?? "./testdata/fastfetch_2.55.0_amd64.deb");

const TEST_S3 = {
    endpoint: process.env.APTLY_TEST_S3_ENDPOINT ?? "http://localhost:9000",
    region: process.env.APTLY_TEST_S3_REGION ?? "us-east-1",
    bucket: process.env.APTLY_TEST_S3_BUCKET ?? "leios-test-bucket",
    prefix: process.env.APTLY_TEST_S3_PREFIX ?? "test-prefix",
    accessKeyId: process.env.APTLY_TEST_S3_ACCESS_KEY_ID ?? "test-access-key",
    secretAccessKey: process.env.APTLY_TEST_S3_SECRET_ACCESS_KEY ?? "test-secret-key",
};

const DEFAULT_APTLY_PORT = Number(process.env.APTLY_TEST_PORT ?? 18110);

export interface AptlyHarness {
    root: string;
    stop: () => Promise<void>;
    cleanup: () => Promise<void>;
}

async function fixtureBinaryExists() {
    try {
        await fs.access(FIXTURE_APTLY_BIN);
        return true;
    } catch {
        return false;
    }
}

async function createIsolatedAptlyRoot(): Promise<string> {
    const root = await fs.mkdtemp(path.join(process.cwd(), "tmp-aptly-"));
    await fs.mkdir(path.join(root, "bin"), { recursive: true });
    const targetBin = path.join(root, "bin/aptly");

    if (await fixtureBinaryExists()) {
        await fs.copyFile(FIXTURE_APTLY_BIN, targetBin);
    } else {
        // As a fallback, download the binary into the temp root
        await AptlyUtils.downloadAptlyBinaryIfNeeded(targetBin);
    }
    return root;
}

function buildAptlySettings(aptlyRoot: string, port: number): AptlyAPISettings {
    return {
        aptlyRoot,
        aptlyPort: port,
        s3Settings: {
            endpoint: TEST_S3.endpoint,
            region: TEST_S3.region,
            bucket: TEST_S3.bucket,
            prefix: TEST_S3.prefix,
            accessKeyId: TEST_S3.accessKeyId,
            secretAccessKey: TEST_S3.secretAccessKey,
        },
        keySettings: {
            publicKeyPath: path.join(FIXTURE_KEYS_DIR, process.env.APTLY_TEST_PUBLIC_KEY ?? "public-key.gpg"),
            privateKeyPath: path.join(FIXTURE_KEYS_DIR, process.env.APTLY_TEST_PRIVATE_KEY ?? "private-key.gpg"),
        },
    };
}

export async function startAptlyTestServer(port: number): Promise<AptlyHarness> {
    const root = await createIsolatedAptlyRoot();

    const cleanupRoot = async () => {
        await fs.rm(root, { recursive: true, force: true });
    };

    // For tests we skip publish to avoid needing a real S3 endpoint
    const originalSkipPublish = process.env.APTLY_SKIP_PUBLISH;
    process.env.APTLY_SKIP_PUBLISH = originalSkipPublish ?? "1";

    try {
        await AptlyAPIServer.init(buildAptlySettings(root, port));
        await AptlyAPIServer.start();
    } catch (err) {
        await cleanupRoot();
        throw err;
    }

    const stop = async () => {
        await AptlyAPIServer.stop("SIGINT");
    };

    const cleanup = async () => {
        process.env.APTLY_SKIP_PUBLISH = originalSkipPublish;
        await cleanupRoot();
    };

    return { root, stop, cleanup };
}

let sharedHarnessPromise: Promise<AptlyHarness> | null = null;

export function getSharedAptlyHarness(port: number = DEFAULT_APTLY_PORT) {
    if (!sharedHarnessPromise) {
        sharedHarnessPromise = startAptlyTestServer(port);
    }
    return sharedHarnessPromise;
}

export async function uploadFixtureToArchive(skipMaintainerCheck = false) {
    const file = new File([await Bun.file(FIXTURE_DEB).arrayBuffer()], "package.deb");
    await AptlyAPI.Packages.uploadAndVerify(
        "leios-archive",
        {
            name: "fastfetch",
            version: "2.55.0",
            architecture: "amd64",
            maintainer_name: "Carter Li",
            maintainer_email: "zhangsongcui@live.cn",
        },
        file,
        skipMaintainerCheck
    );
}

export async function cleanupAptlyPackages(packageName = "fastfetch") {
    try {
        await AptlyAPI.Packages.deleteAllInAllRepos(packageName);
        await AptlyAPI.DB.cleanup();
    } catch {
        // best-effort cleanup for tests
    }
}

export function uniqueAptlyRootName() {
    return `tmp-aptly-${randomUUID().slice(0, 8)}`;
}
