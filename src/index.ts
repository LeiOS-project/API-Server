import { API } from "./api";
import { AptlyAPIServer } from "./aptly/server";
import { DB } from "./db";
import { ConfigHandler } from "./utils/config";
import { Logger } from "./utils/logger";
import { TaskScheduler } from "./tasks";
import { LiveRepoUtils } from "./utils/live-repo";

export class Main {

    static async main() {

        process.once("SIGINT", (type) => Main.gracefulShutdown(type, 0));
        process.once("SIGTERM", (type) => Main.gracefulShutdown(type, 0));

        process.once("uncaughtException", Main.handleUncaughtException);
        process.once("unhandledRejection", Main.handleUnhandledRejection);

        const config = await ConfigHandler.loadConfig();

        Logger.setLogLevel(config.LRA_LOG_LEVEL ?? "info");

        await DB.init(
            config.LRA_DB_PATH ?? "./data/db.sqlite"
        );

        // start task scheduler
        await TaskScheduler.processQueue();

        await LiveRepoUtils.uploadAdditionalFilesIfNeeded({
            endpoint: config.LRA_S3_ENDPOINT,
            region: config.LRA_S3_REGION,
            bucket: config.LRA_S3_BUCKET,
            accessKeyId: config.LRA_S3_ACCESS_KEY_ID,
            secretAccessKey: config.LRA_S3_SECRET_ACCESS_KEY
        }, config.LRA_PUBLIC_KEY_PATH ?? "./data/keys/public-key.gpg");

        await AptlyAPIServer.init({
            aptlyRoot: config.LRA_APTLY_ROOT ?? "./data/aptly",
            aptlyPort: parseInt(config.LRA_APTLY_PORT ?? "12150"),
            s3Settings: {
                endpoint: config.LRA_S3_ENDPOINT,
                region: config.LRA_S3_REGION,
                bucket: config.LRA_S3_BUCKET,
                prefix: config.LRA_S3_PREFIX || "leios/",
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

    }

    private static async gracefulShutdown(type: NodeJS.Signals, code: number) {
        try {
            Logger.log(`Received ${type}, shutting down...`);
            await API.stop();
            await AptlyAPIServer.stop(type);
            await TaskScheduler.stopProcessing();
            Logger.log("Shutdown complete, exiting.");
            process.exit(code);
        } catch {
            Logger.critical("Error during shutdown, forcing exit");
            Main.forceShutdown();
        }
    }

    private static forceShutdown() {
        process.once("SIGTERM", ()=>{});
        process.exit(1);
    }

    private static async handleUncaughtException(error: Error) {
        Logger.critical(`Uncaught Exception:\n${error.stack}`);
        Main.gracefulShutdown("SIGTERM", 1);
    }

    private static async handleUnhandledRejection(reason: any) {
        if (reason.stack) {
            // reason is an error
            return Main.handleUncaughtException(reason);
        }
        Logger.critical(`Unhandled Rejection:\n${reason}`);
        Main.gracefulShutdown("SIGTERM", 1);
    }

}

Main.main()