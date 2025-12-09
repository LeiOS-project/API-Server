import { afterAll, beforeAll } from "bun:test";
import { cleanupAptlyPackages, getSharedAptlyHarness } from "./aptlyTestUtils";
import { AptlyAPIServer } from "../../src/aptly/server";
import { ConfigHandler } from "../../src/utils/config";
import { DB } from "../../src/db";
import { API } from "../../src/api";

// Allow overriding the env file used for tests without clobbering existing env vars.
const TEST_ENV_FILE = process.env.TEST_ENV_FILE ?? ".env";

async function loadTestEnv(filePath: string) {
    try {
        const content = await Bun.file(filePath).text();
        for (const rawLine of content.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#")) continue;
            const [key, ...rest] = line.split("=");
            if (!key) continue;
            const value = rest.join("=").trim();
            if (process.env[key] === undefined) {
                process.env[key] = value;
            }
        }
    } catch (err: any) {
        if (err?.code !== "ENOENT") throw err;
    }
}

// Start the shared Aptly server once for all tests and centralize cleanup.
let harnessPromise: ReturnType<typeof getSharedAptlyHarness> | null = null;

beforeAll(async () => {
    await loadTestEnv(TEST_ENV_FILE);

    const config = await ConfigHandler.loadConfig();

    const tempDataDir = "";

    await DB.init(
        config.LRA_DB_PATH ?? "./data/db.sqlite"
    );

    await AptlyAPIServer.init({
        aptlyRoot: config.LRA_APTLY_ROOT ?? "./data/aptly",
        aptlyPort: parseInt(config.LRA_APTLY_PORT ?? "12150"),
        s3Settings: {
            endpoint: config.LRA_S3_ENDPOINT,
            region: config.LRA_S3_REGION,
            bucket: config.LRA_S3_BUCKET,
            prefix: config.LRA_S3_PREFIX,
            accessKeyId: config.LRA_S3_ACCESS_KEY_ID,
            secretAccessKey: config.LRA_S3_SECRET_ACCESS_KEY
        },
        keySettings: {
            publicKeyPath: config.LRA_PUBLIC_KEY_PATH ?? "./data/keys/public-key.gpg",
            privateKeyPath: config.LRA_PRIVATE_KEY_PATH ?? "./data/keys/private-key.gpg",
        }
    });

    await API.init();

    await AptlyAPIServer.start();

    await API.start(
        parseInt(config.LRA_API_PORT ?? "12151"),
        config.LRA_API_HOST ?? "::"
    );

});

afterAll(async () => {
    await cleanupAptlyPackages();
    if (harnessPromise) {
        const harness = await harnessPromise;
        await harness.stop();
        await harness.cleanup();
    }
});
