import { API } from "./api";
import { AptlyAPI } from "./aptly";
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

        await AptlyAPI.init({
            aptlyBinaryPath: config.LRA_APTLY_BINARY_PATH ?? "./data/aptly/aptly",
            aptlyConfigPath: config.LRA_APTLY_CONFIG_PATH ?? "./data/aptly/aptly.conf",
            aptlyDataPath: config.LRA_APTLY_DATA_PATH ?? "./data/aptly/data",
            aptlyPort: parseInt(config.LRA_APTLY_PORT ?? "12150"),
        });

        await API.init();

        await API.start(
            parseInt(config.LRA_API_PORT ?? "12151"),
            config.LRA_API_HOST ?? "::"
        );

    }

}

Main.main()