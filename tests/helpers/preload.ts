import fs from "fs/promises";
import path from "path";
import { afterAll, beforeAll } from "bun:test";
import { AptlyAPIServer } from "../../src/aptly/server";
import { ConfigHandler } from "../../src/utils/config";
import { DB } from "../../src/db";
import { API } from "../../src/api";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

// Allow overriding the env file used for tests without clobbering existing env vars.
const TEST_ENV_FILE = process.env.TEST_ENV_FILE ?? ".env.test.local";

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

async function createIsolatedDataDir(): Promise<string> {
    const root = await fs.mkdtemp(path.join(process.cwd(), "tmp-data-"));
    return root;
}

let TMP_ROOT: string | null = null;

beforeAll(async () => {
    await loadTestEnv(TEST_ENV_FILE);

    const config = await ConfigHandler.loadConfig();

    TMP_ROOT = await createIsolatedDataDir();

    const drizzleDb = drizzle(path.join(TMP_ROOT, "db.sqlite"));
    migrate(drizzleDb, { migrationsFolder: "drizzle" });

    await DB.init(
        path.join(TMP_ROOT, "db.sqlite"),
        TMP_ROOT
    );

    await AptlyAPIServer.init({
        aptlyRoot: path.join(TMP_ROOT, "aptly"),
        aptlyPort: 12150,
        s3Settings: {
            endpoint: config.LRA_S3_ENDPOINT,
            region: config.LRA_S3_REGION,
            bucket: config.LRA_S3_BUCKET,
            prefix: config.LRA_S3_PREFIX,
            accessKeyId: config.LRA_S3_ACCESS_KEY_ID,
            secretAccessKey: config.LRA_S3_SECRET_ACCESS_KEY
        },
        keySettings: {
            publicKeyPath: config.LRA_PUBLIC_KEY_PATH,
            privateKeyPath: config.LRA_PRIVATE_KEY_PATH
        }
    });

    await API.init();

    await AptlyAPIServer.start();

    await API.start(12151, "::");

});

afterAll(async () => {
    if (TMP_ROOT) {

        await fs.rm(TMP_ROOT, { recursive: true, force: true });
    }
});
