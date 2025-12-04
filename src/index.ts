import { API } from "./api";
import { AptlyAPIServer } from "./aptly/server";
import { DB } from "./db";
import { ConfigHandler } from "./utils/config";
import { Logger } from "./utils/logger";

export class Main {

    static async main() {

        const config = await ConfigHandler.loadConfig();

        Logger.setLogLevel(config.LRA_LOG_LEVEL ?? "info");

        await DB.init(
            config.LRA_DB_PATH ?? "./data/db.sqlite"
        );

        await AptlyAPIServer.init({
            aptlyRoot: config.LRA_APTLY_ROOT ?? "./data/aptly",
            aptlyPort: parseInt(config.LRA_APTLY_PORT ?? "12150"),
        });

        await API.init();

        await AptlyAPIServer.start();

        await API.start(
            parseInt(config.LRA_API_PORT ?? "12151"),
            config.LRA_API_HOST ?? "::"
        );

        process.on("SIGINT", (type) => this.onKill(type));
        process.on("SIGTERM", (type) => this.onKill(type));

    }

    private static onKill(type: NodeJS.Signals) {
        Logger.log(`Received ${type}, shutting down...`);
        API.stop();
        AptlyAPIServer.stop(type);
        process.exit();
    }

}

Main.main()