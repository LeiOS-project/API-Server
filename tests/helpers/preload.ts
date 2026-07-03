import fs from "fs/promises";
import path from "path";
import { afterAll, beforeAll } from "bun:test";
import { AptlyAPIServer } from "../../src/aptly/server";
import { ConfigHandler, type ParsedConfig } from "../../src/utils/config";
import { DB } from "../../src/db";
import { API } from "../../src/api";
import { PermissionHelper } from "../../src/utils/permission-helper";
import S3rver from "s3rver";
import { ensureTestPackageFixtures } from "./package-fixtures";

function setTestEnv(rootDir: string) {

    const envVars = {
        LRA_LOG_LEVEL: "debug",

        LRA_HUB_URL: "http://localhost:12153",
        
        LRA_API_HOST: "::",
        LRA_API_PORT: "12151",
        LRA_API_DISABLE_DOCS: true,

        LRA_LOG_DIR: path.join(rootDir, "logs"),

        LRA_DB_PATH: path.join(rootDir, "db.sqlite"),
        LRA_DB_AUTO_MIGRATE: true,

        LRA_APTLY_ROOT: path.join(rootDir, "aptly"),
        LRA_APTLY_PORT: "12150",
        
        LRA_CONFIG_BASE_DIR: rootDir,
        LRA_PRIVATE_KEY_PATH: path.join(rootDir, "keys", "private-key.gpg"),
        LRA_PUBLIC_KEY_PATH: path.join(rootDir, "keys", "public-key.gpg"),

        LRA_S3_ENDPOINT: "http://localhost:4568",
        LRA_S3_REGION: "us-east-1",
        LRA_S3_BUCKET: "leios-test-repo",
        LRA_S3_PREFIX: "leios/",
        LRA_S3_ACCESS_KEY_ID: "S3RVER",
        LRA_S3_SECRET_ACCESS_KEY: "S3RVER",

        LRA_SMTP_HOST: "127.0.0.1",
        LRA_SMTP_PORT: "12587",
        LRA_SMTP_USERNAME: "",
        LRA_SMTP_PASSWORD: "",
        LRA_SMTP_FROM: "\"LeiOS Test\" <test@leios.local>",
        LRA_SMTP_SECURE: false,

    } as const satisfies ParsedConfig;

    for (const [key, value] of Object.entries(envVars)) {
        process.env[key] = String(value);
    }
}

async function runCommand(cmd: string[]) {
    const process = Bun.spawn({
        cmd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
        process.stdout ? new Response(process.stdout).text() : Promise.resolve(""),
        process.stderr ? new Response(process.stderr).text() : Promise.resolve(""),
        process.exited,
    ]);

    if (exitCode !== 0) {
        throw new Error(`Command failed: ${cmd.join(" ")}\n${stderr || stdout}`.trim());
    }
}

async function generateTestGPGKeyPair(rootDir: string) {
    const keysDir = path.join(rootDir, "keys");
    const gpgHome = path.join(rootDir, "gpg-home");
    const batchConfigPath = path.join(rootDir, "gpg-batch.conf");
    const timestamp = Date.now();
    const keyEmail = `test-${timestamp}@leios.local`;
    const keyIdentity = `LeiOS Test Key <${keyEmail}>`;

    await fs.mkdir(keysDir, { recursive: true });
    await fs.mkdir(gpgHome, { recursive: true });
    await fs.chmod(gpgHome, 0o700);

    await Bun.write(batchConfigPath, [
        "%no-protection",
        "Key-Type: RSA",
        "Key-Length: 2048",
        "Subkey-Type: RSA",
        "Subkey-Length: 2048",
        "Name-Real: LeiOS Test Key",
        `Name-Email: ${keyEmail}`,
        "Expire-Date: 0",
        "%commit",
        "",
    ].join("\n"));

    await runCommand([
        "gpg",
        "--batch",
        "--homedir", gpgHome,
        "--generate-key", batchConfigPath,
    ]);

    await runCommand([
        "gpg",
        "--batch",
        "--yes",
        "--homedir", gpgHome,
        "--armor",
        "--output", path.join(keysDir, "public-key.gpg"),
        "--export", keyIdentity,
    ]);

    await runCommand([
        "gpg",
        "--batch",
        "--yes",
        "--homedir", gpgHome,
        "--armor",
        "--output", path.join(keysDir, "private-key.gpg"),
        "--export-secret-keys", keyIdentity,
    ]);
}

async function createIsolatedDataDir(): Promise<string> {
    const root = await fs.mkdtemp(path.join(process.cwd(), "tmp-data-"));
    return root;
}

let TMP_ROOT: string | null = null;
let s3rverInstance: S3rver | null = null;

beforeAll(async () => {
    TMP_ROOT = await createIsolatedDataDir();

    await ensureTestPackageFixtures();

    setTestEnv(TMP_ROOT);

    await generateTestGPGKeyPair(TMP_ROOT);

    const config = await ConfigHandler.loadConfig();
    
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
        s3rverInstance!.run((err?: Error | null) => {
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

    // EmailService is NOT initialised here — tests that need it call
    // EmailService.init(mockTransport) in their own beforeAll.

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
