
export class Logger {

    private static readonly logLevelMap = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
        critical: 4,
    } as const;

    private static logLevel: typeof this.logLevelMap[Logger.LogLevel] = this.logLevelMap.info;
    
    static setLogLevel(level: Logger.LogLevel) {
        if (this.logLevelMap[level] === undefined) {
            throw new Error(`Invalid log level: ${level}`);
        }
        this.logLevel = this.logLevelMap[level];
    }

    static getLogLevel(): Logger.LogLevel {
        const match = Object.entries(this.logLevelMap).find(([_, value]) => value === this.logLevel);
        return (match ? match[0] : "info") as Logger.LogLevel;
    }

    static debug(...args: any[]) {
        if (this.logLevel <= this.logLevelMap.debug) {
            console.debug("[DEBUG]", ...args);
        }
    }

    static log(...args: any[]) {
        if (this.logLevel <= this.logLevelMap.info) {
            console.log("[INFO]", ...args);
        }
    }

    static info(...args: any[]) {
        if (this.logLevel <= this.logLevelMap.info) {
            console.info("[INFO]", ...args);
        }
    }

    static warn(...args: any[]) {
        if (this.logLevel <= this.logLevelMap.warn) {
            console.warn("[WARN]", ...args);
        }
    }

    static error(...args: any[]) {
        if (this.logLevel <= this.logLevelMap.error) {
            console.error("[ERROR]", ...args);
        }
    }

    static critical(...args: any[]) {
        if (this.logLevel <= this.logLevelMap.critical) {
            console.error("[CRITICAL]", ...args);
        }
    }

}

export namespace Logger {
    export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";
}