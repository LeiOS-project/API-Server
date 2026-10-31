import { z } from "zod";
import { AppConstants } from "./constants";
import { Logger } from "./logger";

interface ConfigSchemaSettings {
	[key: string]: CS.ConfigItem<z.ZodType>;
}

type ConfigLike<T extends ConfigSchemaSettings> = {
	[K in keyof T]: z.infer<T[K]["_schema"]>;
};

class CS {
	private constructor() {}

	static string() {
		return new CS.ConfigItem(z.string());
	}

	static number() {
		return new CS.ConfigItem(z.coerce.number());
	}

	static boolean() {
		return new CS.ConfigItem(
			z.union(
				[
					z.boolean(),
					z
						.string()
						.refine((val) => val === "true" || val === "false")
						.transform((val) => val === "true"),
				],
				{ error: "Expected a boolean value ('true' or 'false')" },
			),
		);
	}

	static enum<const T extends readonly string[]>(values: T) {
		return new CS.ConfigItem(z.enum(values));
	}

	static array() {
		return new CS.ConfigItem(
			z.string().transform<string[]>((val) => {
				if (typeof val === "string") {
					return val
						.split(",")
						.map((v) => v.trim())
						.filter(Boolean);
				}
				return [];
			}),
		);
	}
}

namespace CS {
	export class ConfigItem<const Schema extends z.ZodType> {
		constructor(public _schema: Schema) {}

		public parse(value: unknown) {
			return this._schema.safeParse(value);
		}

		public default(value: z.util.NoUndefined<z.core.output<Schema>>) {
			this._schema = this._schema.default(value) as any;
			return this as any as ConfigItem<z.ZodDefault<Schema>>;
		}

		public optional() {
			this._schema = this._schema.optional() as any;
			return this as any as ConfigItem<z.ZodOptional<Schema>>;
		}
	}
}

class ConfigSchema<T extends ConfigSchemaSettings> {
	readonly schema: T;

	constructor(schema: T) {
		this.schema = schema;
	}

	public parse() {
		const result: ConfigLike<T> = {} as ConfigLike<T>;

		for (const [key, settings] of Object.entries(this.schema)) {
			const value = process.env[`${AppConstants.APP_ENV_PREFIX}_${key}`];

			const parseResult = settings.parse(value);
			if (!parseResult.success) {
				Logger.error(
					`Failed to read the environment variable ${key}: ${parseResult.error.issues[0]?.message}`,
				);
				process.exit(1);
			}

			// Store the parsed (coerced/defaulted) value, not the raw env string —
			// otherwise numbers/booleans stay strings and defaults/optionals are lost.
			(result[key] as any) = parseResult.data;
		}
		return result;
	}
}

export type ENVConfigLike = {
	[K in Extract<
		keyof typeof ConfigHandler.schema.schema,
		string
	> as `${typeof AppConstants.APP_ENV_PREFIX}_${K}`]: z.infer<
		(typeof ConfigHandler.schema.schema)[K]["_schema"]
	>;
};

export type ParsedConfig = ConfigLike<typeof ConfigHandler.schema.schema>;

export class ConfigHandler {
	// Public so ENVConfigLike / ParsedConfig can derive from it without @ts-ignore.
	// Treat it as read-only.
	static schema = new ConfigSchema({
		LOG_LEVEL: CS.enum(["debug", "info", "warn", "error", "critical"]).default("info"),

		API_HOST: CS.string().default("::"),
		API_PORT: CS.number().default(AppConstants.APP_API_DEFAULT_PORT),
		API_DISABLE_DOCS: CS.boolean().default(false),
		/**
		 * Behind a reverse proxy: take the client address for rate limits from the first
		 * X-Forwarded-For entry. Leave off when clients reach the API directly (they could spoof it).
		 */
		API_TRUST_PROXY: CS.boolean().default(false),

		DB_PATH: CS.string().default("./data/db.sqlite"),
		DB_AUTO_MIGRATE: CS.boolean().default(true),
		DB_MIGRATION_DIR: CS.string().default("./drizzle/migrations"),

		LOG_DIR: CS.string().default("./data/logs"),
		CONFIG_BASE_DIR: CS.string().default("./config"),

		/** The Hub's public URL: CORS origin and base of the links in emails. */
		APP_URL: CS.string().default(AppConstants.APP_DEFAULT_HUB_URL),

		APTLY_ROOT: CS.string().default("./data/aptly"),
		/** 0 lets Aptly bind to a random free port from the dynamic range. */
		APTLY_PORT: CS.number().default(0),

		BRANDING_META_FILES_DATA_PATH: CS.string().default("./data/branding-meta-files"),

		PRIVATE_KEY_PATH: CS.string(),
		PUBLIC_KEY_PATH: CS.string(),

		S3_ENDPOINT: CS.string(),
		S3_REGION: CS.string(),
		S3_BUCKET: CS.string(),
		S3_PREFIX: CS.string().default("leios/"),
		S3_ACCESS_KEY_ID: CS.string(),
		S3_SECRET_ACCESS_KEY: CS.string(),

		/** Self-service signup. Stays off while email is not configured (signup needs verification). */
		SIGNUP_ENABLED: CS.boolean().default(false),

		SMTP_HOST: CS.string().optional(),
		SMTP_PORT: CS.number().optional(),
		SMTP_USERNAME: CS.string().optional(),
		SMTP_PASSWORD: CS.string().optional(),
		SMTP_FROM: CS.string().optional(),
		SMTP_SECURE: CS.boolean().optional(),
	});

	private static config: ParsedConfig | null = null;

	/** You have to call {@link ConfigHandler.loadConfig} before trying to access the config. */
	static getConfig() {
		return this.config;
	}

	static async loadConfig() {
		if (this.config) return this.config;
		this.applyDeprecatedEnvNames();
		this.config = this.schema.parse();
		return this.config;
	}

	/** Env names that were renamed, mapped to their replacement. */
	protected static readonly DEPRECATED_ENV_NAMES = {
		LRA_HUB_URL: "LRA_APP_URL",
	} as const;

	/** Copies a deprecated env var to its new name when only the old one is set, with a warning. */
	protected static applyDeprecatedEnvNames() {
		for (const [oldName, newName] of Object.entries(this.DEPRECATED_ENV_NAMES)) {
			const oldValue = process.env[oldName];
			if (oldValue === undefined) continue;

			if (process.env[newName] === undefined) {
				process.env[newName] = oldValue;
			}
			Logger.warn(
				`${oldName} is deprecated and will be removed in a future release; use ${newName} instead.`,
			);
		}
	}
}
