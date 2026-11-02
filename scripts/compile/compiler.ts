import { AppConstants } from "../../src/utils/constants";

/**
 * The compile engine: wraps `bun build --compile --sourcemap --minify --bytecode` and injects
 * `APP_VERSION` via `--define`. Targets: linux-x64 (modern), linux-x64-baseline, linux-arm64.
 * The binary name comes from `AppConstants.BINARY_NAME`. See docs/11-cli-and-infra.md.
 */
export enum Platforms {
	"linux-x64" = "bun-linux-x64-modern",
	"linux-x64-baseline" = "bun-linux-x64-baseline",
	"linux-arm64" = "bun-linux-arm64",

	// "win-x64" = "bun-windows-x64-modern",
	// "win-x64-baseline" = "bun-windows-x64-baseline",

	// "macos-x64" = "bun-darwin-x64-modern",
	// "macos-x64-baseline" = "bun-darwin-x64-baseline",
	// "macos-arm64" = "bun-darwin-arm64"
}

export type PlatformArg = keyof typeof Platforms | "auto";

class CompilerCommand {
	public sourcemap = true;
	public minify = true;
	public bytecode = true;
	public entrypoint = "./scripts/entrypoint.ts";
	// Set the name in AppConstants.BINARY_NAME (src/utils/constants.ts), e.g. leios-api, nowip-api.
	public outfile = `./build/bin/${AppConstants.BINARY_NAME}`;
	public platform: PlatformArg = "auto";
	public env: NodeJS.ProcessEnv = {};
	private additionalArgs: string[] = [];

	constructor(private baseCommand = "bun build --compile") {}

	public addArg(arg: string) {
		this.additionalArgs.push(arg);
	}

	public getCommand() {
		return [
			this.baseCommand,
			this.sourcemap ? "--sourcemap" : "",
			this.minify ? "--minify" : "",
			this.bytecode ? "--bytecode --format=esm" : "",
			this.entrypoint,
			"--outfile",
			this.outfile,
			this.platform === "auto" ? "" : `--target=${Platforms[this.platform]}`,
			...Object.entries(this.env).map(([key, value]) => `--define "process.env.${key}='${value}'"`),
			...this.additionalArgs,
		].join(" ");
	}
}

export class Compiler {
	/** First Bun release whose `bun build --compile` supports `--asset`. */
	static readonly MIN_BUN_VERSION = "1.4.4";

	private command = new CompilerCommand();

	constructor(
		private platform: PlatformArg,
		private version: string,
		versionInFileName: boolean,
	) {
		if (versionInFileName) {
			this.command.outfile += `-v${this.version}`;
		}

		this.command.platform = platform;

		if (platform !== "auto") {
			if (!Object.keys(Platforms).some((p) => p === platform)) {
				throw new Error(`Invalid platform: ${platform}`);
			}
			this.command.outfile += `-${platform}`;
		}

		this.command.env.APP_VERSION = this.version;

		this.command.addArg("--asset ./drizzle/migrations");
	}

	async build() {
		if (!Bun.semver.satisfies(Bun.version, `>=${Compiler.MIN_BUN_VERSION}`)) {
			throw new Error(
				`Compiling needs Bun >= ${Compiler.MIN_BUN_VERSION} to embed the migrations (bun build --asset); this is Bun ${Bun.version}.`,
			);
		}

		try {
			console.log(`Building from sources. Version: ${this.version} Platform: ${this.platform}`);

			const output = await Bun.$`${{ raw: this.command.getCommand() }}`.text();

			console.log(output);
		} catch (err: any) {
			console.log(`Compiling Failed:\n`, err);
		}
	}
}
