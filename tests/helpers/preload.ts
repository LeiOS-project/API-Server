import fs from "fs/promises";
import path from "path";
import { afterAll, beforeAll } from "bun:test";
import { AptlyAPIServer } from "../../src/aptly/server";
import { ConfigHandler } from "../../src/utils/config";
import { DB } from "../../src/db";
import { API } from "../../src/api";
import { PermissionHelper } from "../../src/utils/permission-helper";
import S3rver from "s3rver";

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
let s3rverInstance: S3rver | null = null;

beforeAll(async () => {
    await loadTestEnv(TEST_ENV_FILE);
    
    // We overwrite S3 config specifically for tests to use the local built-in server.
    process.env.LRA_S3_ENDPOINT = "http://localhost:4568";
    process.env.LRA_S3_REGION = "us-east-1";
    process.env.LRA_S3_BUCKET = "leios-test-repo";
    process.env.LRA_S3_ACCESS_KEY_ID = "S3RVER";
    process.env.LRA_S3_SECRET_ACCESS_KEY = "S3RVER";

    const config = await ConfigHandler.loadConfig();

    TMP_ROOT = await createIsolatedDataDir();
    
    // Start local S3 server
    const s3rverDir = path.join(TMP_ROOT, "s3rver");
    await fs.mkdir(s3rverDir, { recursive: true });
    s3rverInstance = new S3rver({
        port: 4568,
        address: "localhost",
        silent: true,
        directory: s3rverDir,
        configureBuckets: [{ name: config.LRA_S3_BUCKET }]
    });
    
    await new Promise<void>((resolve, reject) => {
        s3rverInstance!.run((err) => {
            if (err) reject(err);
            else resolve();
        });
    });

    await DB.init(
        path.join(TMP_ROOT, "db.sqlite"),
        true,
        TMP_ROOT
    );

    await PermissionHelper.init();

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

    await API.stop();

    await AptlyAPIServer.stop();

    await DB.close();

    if (s3rverInstance) {
        await new Promise<void>((resolve) => {
            s3rverInstance!.close(() => resolve());
        });
    }

    if (TMP_ROOT) {
        await fs.rm(TMP_ROOT, { recursive: true, force: true });
    }
});
