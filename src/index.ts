import { API } from "./api";
import { EmailService } from "./api/utils/email";
import { AptlyAPIServer } from "./aptly/server";
import { DB } from "./db";
import { TaskScheduler } from "./tasks";
import { Utils } from "./utils";
import { BrandingBuilder } from "./utils/branding-builder";
import { ConfigHandler } from "./utils/config";
import { AppConstants } from "./utils/constants";
import { LiveRepoUtils } from "./utils/live-repo";
import { Logger } from "./utils/logger";
import { PermissionHelper } from "./utils/permission-helper";

export class Main {
	static async main() {
		process.once("SIGINT", (type) => Main.gracefulShutdown(type, 0));
		process.once("SIGTERM", (type) => Main.gracefulShutdown(type, 0));

		process.once("uncaughtException", Main.handleUncaughtException);
		process.once("unhandledRejection", Main.handleUnhandledRejection);

		const config = await ConfigHandler.loadConfig();

		Logger.setLogLevel(config.LOG_LEVEL);
		Logger.log(`Starting ${AppConstants.APP_NAME} API...`);

		await DB.init(
			config.DB_PATH,
			config.DB_AUTO_MIGRATE,
			config.CONFIG_BASE_DIR,
			config.DB_MIGRATION_DIR,
		);

		await PermissionHelper.init();

		await Utils.ensureDirectoryExists(config.LOG_DIR);

		await EmailService.init();

		// The branding meta files repository is cloned into the data directory on first startup and
		// pulled on later starts (failures are logged but non-fatal).
		await BrandingBuilder.ensureRepo(config.BRANDING_META_FILES_DATA_PATH);

		await AptlyAPIServer.init({
			aptlyRoot: config.APTLY_ROOT,
			aptlyPort: config.APTLY_PORT,
			s3Settings: {
				endpoint: config.S3_ENDPOINT,
				region: config.S3_REGION,
				bucket: config.S3_BUCKET,
				prefix: config.S3_PREFIX,
				accessKeyId: config.S3_ACCESS_KEY_ID,
				secretAccessKey: config.S3_SECRET_ACCESS_KEY,
			},
			keySettings: {
				publicKeyPath: config.PUBLIC_KEY_PATH,
				privateKeyPath: config.PRIVATE_KEY_PATH,
			},
		});

		await LiveRepoUtils.uploadAdditionalFilesIfNeeded(
			{
				endpoint: config.S3_ENDPOINT,
				region: config.S3_REGION,
				bucket: config.S3_BUCKET,
				accessKeyId: config.S3_ACCESS_KEY_ID,
				secretAccessKey: config.S3_SECRET_ACCESS_KEY,
			},
			config.PUBLIC_KEY_PATH,
		);

		await API.init([config.APP_URL], config.API_DISABLE_DOCS);

		await AptlyAPIServer.start();

		// Divergence from the style guide's order (task queue right before API.init): resumed tasks
		// such as testing-repo updates call Aptly directly, so the queue starts once Aptly is up.
		// Not awaited, so a backlog of resumed tasks does not hold up the API.
		TaskScheduler.processQueue().catch((err) => {
			Logger.error("Task queue processing failed:", err);
		});

		await API.start(config.API_PORT, config.API_HOST);
	}

	private static async gracefulShutdown(type: NodeJS.Signals, code: number) {
		try {
			Logger.log(`Received ${type}, shutting down...`);

			await API.stop();

			await AptlyAPIServer.stop(type);

			await EmailService.reset();
			await TaskScheduler.stopProcessing();

			await DB.close();

			Logger.log("Shutdown complete, exiting.");
			process.exit(code);
		} catch {
			Logger.critical("Error during shutdown, forcing exit");
			Main.forceShutdown();
		}
	}

	private static forceShutdown() {
		process.once("SIGTERM", () => {});
		process.exit(1);
	}

	private static async handleUncaughtException(error: Error) {
		Logger.critical(
			`Uncaught Exception:\n${Error.isError(error) ? (error.stack ? error.stack : error.message) : error}`,
		);
		Main.gracefulShutdown("SIGTERM", 1);
	}

	private static async handleUnhandledRejection(reason: any) {
		if (Error.isError(reason)) {
			// reason is an error
			return Main.handleUncaughtException(reason);
		}
		Logger.critical(`Unhandled Rejection:\n${reason}`);
		Main.gracefulShutdown("SIGTERM", 1);
	}
}

Main.main().catch((err) => {
	Logger.error("Fatal startup error:", err);
	process.exit(1);
});
