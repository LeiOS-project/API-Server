import fs from "fs/promises";
import path from "path";
import { AptlyAPIServer } from "./server";
import { AptlyUtils } from "./utils";
import { Logger } from "../utils/logger";
import z from "zod";

export namespace AptlyAPI.Utils {

    export const REPOS = ["leios-stable", "leios-testing", "leios-archive"] as const;
    export type Repos = (typeof REPOS)[number];

    export const ARCHITECTURES = ["amd64", "arm64", "all"] as const;
    export type Architectures = (typeof ARCHITECTURES)[number];

}

export namespace AptlyAPI.Response {

    export function success<TReturn>(data: TReturn): Success<TReturn> {
        return { data, error: null };
    }

    export function err<T extends string>(message: T): Error<T> {
        return { data: null, error: message };
    }

    export type Success<T> = {
        data: T;
        error: null;
    };

    export type Error<T extends string> = {
        data: null;
        error: T;
    };

    export type Combined<TData, TError extends string> = Success<TData> | Error<TError>;

}

/**
 * Runs aptly operations that create aptly tasks (everything that changes a
 * repository, the database or a publish) one at a time and waits for each
 * with a time limit.
 *
 * The calls are made with `_async=true`, so aptly returns the task at once
 * and we poll it: a task that never finishes becomes an error instead of a
 * request that blocks forever. Running one task at a time also avoids two
 * problems of aptly's task queue (1.6.3): a running `db cleanup` does not
 * hold back tasks started after it, and tasks have been seen waiting forever
 * with no task running.
 */
export namespace AptlyAPI.Tasks {

    // aptly's task.State values
    const STATE_IDLE = 0;
    const STATE_RUNNING = 1;
    const STATE_SUCCEEDED = 2;
    const STATE_FAILED = 3;

    const POLL_INTERVAL_MS = 250;
    const REQUEST_TIMEOUT_MS = 30_000;
    /** Upper limit for one task, publishing to S3 included. */
    export const TASK_TIMEOUT_MS = 30 * 60_000;
    /**
     * aptly only starts a waiting task when another task finishes. A task
     * that waits this long while no task runs will never start.
     */
    export const STUCK_TIMEOUT_MS = 30_000;

    const StartedTask = z.object({ ID: z.number() });
    const ReturnValue = z.object({ Code: z.number(), Value: z.unknown() }).nullable();

    let lastTask: Promise<unknown> = Promise.resolve();

    function exclusive<T>(fn: () => Promise<T>): Promise<T> {
        const result = lastTask.then(fn, fn);
        lastTask = result.catch(() => undefined);
        return result;
    }

    function describeError(error: unknown) {
        if (typeof error === "object" && error !== null && "error" in error) {
            return String(error.error);
        }
        return String(error);
    }

    async function waitUntilFinished(id: number, name: string) {
        const client = AptlyAPIServer.getClient();
        const deadline = Date.now() + TASK_TIMEOUT_MS;
        let waitingAloneSince: number | null = null;

        while (true) {
            const task = await client.getApiTasksById({ path: { id }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
            const state = task.data?.State;
            if (state === undefined) {
                throw new Error(`Lost track of aptly task #${id} (${name}): ${describeError(task.error)}`);
            }
            if (state === STATE_SUCCEEDED || state === STATE_FAILED) {
                return state;
            }

            if (state === STATE_IDLE) {
                const tasks = await client.getApiTasks({ signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
                const anyRunning = tasks.data?.some(t => t.State === STATE_RUNNING) ?? true;
                if (anyRunning) {
                    waitingAloneSince = null;
                } else {
                    waitingAloneSince ??= Date.now();
                    if (Date.now() - waitingAloneSince >= STUCK_TIMEOUT_MS) {
                        throw new Error(`aptly task #${id} (${name}) is waiting for a lock that no running task holds, so aptly's task queue is stuck. Restart the API to restart aptly.`);
                    }
                }
            } else {
                waitingAloneSince = null;
            }

            if (Date.now() >= deadline) {
                throw new Error(`aptly task #${id} (${name}) did not finish within ${TASK_TIMEOUT_MS / 60_000} minutes.`);
            }
            await Bun.sleep(POLL_INTERVAL_MS);
        }
    }

    /**
     * Starts an aptly task with `start` (which must pass `query` on to the
     * aptly call) and returns the task's return value, or its error message.
     * Throws if the task does not finish in time.
     */
    export function run<T = unknown>(
        name: string,
        start: (query: { _async: true }) => Promise<{ data?: unknown; error?: unknown }>
    ): Promise<AptlyAPI.Response.Combined<T | null, string>> {
        return exclusive(async () => {
            const client = AptlyAPIServer.getClient();

            const started = await start({ _async: true });
            const task = StartedTask.safeParse(started.data);
            if (started.error || !task.success) {
                return AptlyAPI.Response.err(`${name}: ${describeError(started.error ?? "aptly did not return a task")}`);
            }
            const id = task.data.ID;

            const state = await waitUntilFinished(id, name);
            try {
                if (state === STATE_FAILED) {
                    const output = await client.getApiTasksByIdOutput({ path: { id }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
                    const lastLine = String(output.data ?? "").trim().split("\n").pop() || "failed";
                    return AptlyAPI.Response.err(`${name}: ${lastLine}`);
                }
                const returnValue = await client.getApiTasksByIdReturnValue({ path: { id }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
                const value = ReturnValue.parse(returnValue.data ?? null)?.Value ?? null;
                return AptlyAPI.Response.success(value as T | null);
            } finally {
                // aptly keeps finished tasks until they are deleted.
                await client.deleteApiTasksById({ path: { id }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch(() => null);
            }
        });
    }

}

export namespace AptlyAPI.DB {

    export async function cleanup() {
        const result = await AptlyAPI.Tasks.run("clean up db", (query) =>
            AptlyAPIServer.getClient().postApiDbCleanup({ query })
        );
        return result.error === null;
    }

}

export namespace AptlyAPI.Packages {

    export async function getRefInRepo(repoName: AptlyAPI.Utils.Repos, packageFullName: string, packageVersionWithLeiosPatch?: string, packageArch?: AptlyAPI.Utils.Architectures) {
        const refsResult = await AptlyAPIServer.getClient().getApiReposByNamePackages({
            path: {
                name: repoName
            },
            query: {
                q: `Name (${packageFullName})` + (packageVersionWithLeiosPatch ? `, Version (${packageVersionWithLeiosPatch})` : "") + (packageArch ? `, Architecture (${packageArch})` : ""),
                withDeps: "",
                format: "",
                maximumVersion: ""
            }
        });

        if (!refsResult.data) {
            throw new Error("Failed to query package references: " + refsResult.error);
        }

        return refsResult.data as any as string[] || [];
    }

    export async function getInRepo(repoName: AptlyAPI.Utils.Repos, packageFullName: string, packageVersionWithLeiosPatch?: string, packageArch?: AptlyAPI.Utils.Architectures) {
        const result = await AptlyAPIServer.getClient().getApiReposByNamePackages({
            path: {
                name: repoName
            },
            query: {
                q: `Name (${packageFullName})` + (packageVersionWithLeiosPatch ? `, Version (${packageVersionWithLeiosPatch})` : "") + (packageArch ? `, Architecture (${packageArch})` : ""),
                withDeps: "",
                format: "details",
                maximumVersion: ""
            }
        });
        if (!result.data) {
            throw new Error("Failed to get package: " + result.error);
        }
        const resultData = result.data as any;

        if (!Array.isArray(resultData)) {
            throw new Error("Invalid response from Aptly server.");
        }

        const returnedPackages: Array<AptlyAPI.Packages.Models.PackageInfo> = [];

        for (const pkg of resultData) {

            if (typeof pkg !== 'object') {
                throw new Error("Invalid package data from Aptly server.");
            }

            if (pkg.Package !== packageFullName ||
                (packageVersionWithLeiosPatch && pkg.Version !== packageVersionWithLeiosPatch) ||
                (packageArch && pkg.Architecture !== packageArch)) {
                throw new Error("Package data mismatch from Aptly server.");
            }

            returnedPackages.push({
                name: pkg.Package as string,
                key: pkg.Key as string,
                versionWithLeiosPatch: pkg.Version as string,
                architecture: pkg.Architecture as AptlyAPI.Utils.Architectures,
                maintainer: pkg.Maintainer as string,
                description: pkg.Description as string,
            });
        }

        return returnedPackages;
    }

    export async function getVersionInRepo(repoName: AptlyAPI.Utils.Repos, packageFullName: string, packageVersionWithLeiosPatch: string) {
        const pkgs = await getInRepo(repoName, packageFullName, packageVersionWithLeiosPatch);
        const returnData: {
            "amd64"?: AptlyAPI.Packages.Models.PackageInfo,
            "arm64"?: AptlyAPI.Packages.Models.PackageInfo,
            "all"?: AptlyAPI.Packages.Models.PackageInfo
        } = {};
        
        for (const pkg of pkgs) {
            returnData[pkg.architecture] = pkg;
        }
        return returnData satisfies AptlyAPI.Packages.Models.getVersionInRepoResponse;
    }

    export async function getAllInRepo(repoName: AptlyAPI.Utils.Repos, packageFullName: string) {
        const pkgs = await getInRepo(repoName, packageFullName);
        const returnData: {
            [version: string]: AptlyAPI.Packages.Models.getVersionInRepoResponse
        } = {};

        for (const pkg of pkgs) {
            if (!returnData[pkg.versionWithLeiosPatch]) {
                returnData[pkg.versionWithLeiosPatch] = {};
            }
            (returnData[pkg.versionWithLeiosPatch] as AptlyAPI.Packages.Models.getVersionInRepoResponse)[pkg.architecture] = pkg;
        }
        return returnData satisfies AptlyAPI.Packages.Models.getAllInRepoResponse;
    }

    export async function getAllInAllRepos(packageFullName: string) {
        const pkgsInArchive = await getAllInRepo("leios-archive", packageFullName);
        const pkgsInTesting = await getAllInRepo("leios-testing", packageFullName);
        const pkgsInStable = await getAllInRepo("leios-stable", packageFullName);

        return {
            "leios-archive": pkgsInArchive,
            "leios-testing": pkgsInTesting,
            "leios-stable": pkgsInStable,
        } satisfies AptlyAPI.Packages.Models.getAllInAllReposResponse;
    }

    export async function existsInRepo(repoName: AptlyAPI.Utils.Repos, packageFullName: string, packageVersionWithLeiosPatch?: string, packageArch?: AptlyAPI.Utils.Architectures) {
        const refs = await getRefInRepo(repoName, packageFullName, packageVersionWithLeiosPatch, packageArch);
        return refs.length > 0;
    }

    /**
     * Uploads a Debian package to the repository, validates its metadata, and adds it if verification succeeds.
     *
     * @param packageData - Metadata describing the package, including name, maintainer data, version, optional LeiOS patch, and architecture.
     * @param file - The Debian package file to upload.
     * @param skipMaintainerCheck - When `true`, bypasses maintainer validation; defaults to `false`.
     * @returns A promise that resolves to `true` once the package is successfully added.
     * @throws If the package already exists, fails validation, or cannot be added to the repository.
     */
    export async function uploadAndVerifyIntoArchiveRepo(
        packageData: {
            fullname: string;
            maintainer_name: string;
            maintainer_email: string;
            versionWithLeiosPatch: string;
            architecture: AptlyAPI.Utils.Architectures;
        },
        file: File
    ) {
        const fullPackageVersion = AptlyUtils.buildVersionWithLeiOSSuffix(packageData.versionWithLeiosPatch);

        const existsPackage = await existsInRepo("leios-archive", packageData.fullname, packageData.versionWithLeiosPatch, packageData.architecture);
        if (existsPackage) {
            throw new Error("Package already exists in repository.");
        }

        const uploadSubDir = Bun.randomUUIDv7();
        const packageIdentifier = AptlyUtils.getPackageIdentifier(packageData.fullname, fullPackageVersion, packageData.architecture);
        const fileName = `${packageIdentifier}.deb`;
        const uploadDir = path.join(AptlyAPIServer.aptlyUploadDir, uploadSubDir);
        const fullFilePath = path.join(uploadDir, fileName);

        let shouldCleanup = true;

        await AptlyUtils.ensureDirExists(uploadDir);

        try {
            await Bun.write(fullFilePath, await file.arrayBuffer());

            const dpkgCheckResult = await Bun.$`dpkg --info ${fullFilePath}`.text();

            const validations: Array<{ description: string; ok: boolean; }> = [
                { description: "Uploaded package version mismatch.", ok: dpkgCheckResult.includes(`Version: ${fullPackageVersion}`) },
                { description: "Uploaded package architecture mismatch.", ok: dpkgCheckResult.includes(`Architecture: ${packageData.architecture}`) },
                { description: "Uploaded package name mismatch.", ok: dpkgCheckResult.includes(`Package: ${packageData.fullname}`) },
                {
                    description: "Uploaded package maintainer mismatch.",
                    ok: dpkgCheckResult.includes(`Maintainer: ${packageData.maintainer_name} <${packageData.maintainer_email}>`)
                }
            ];

            const failedValidation = validations.find(v => !v.ok);
            if (failedValidation) {
                throw new Error(failedValidation.description);
            }

            const addingResult = await AptlyAPI.Tasks.run(`add ${fileName} to leios-archive`, (query) =>
                AptlyAPIServer.getClient().postApiReposByNameFileByDirByFile({
                    path: {
                        name: "leios-archive",
                        dir: uploadSubDir,
                        file: fileName
                    },
                    query
                })
            );

            const parsedResult = (addingResult.data as any as { "Report": { "Added": string[] } })?.["Report"]?.["Added"]?.[0] || "";

            if (addingResult.error || !parsedResult.includes("added")) {
                throw new Error("Failed to add package to repository: " + addingResult.error);
            }

            shouldCleanup = false;
            return true;
        } finally {
            if (shouldCleanup) {
                await fs.rm(uploadDir, { recursive: true, force: true });
            }
        }
    }

    /**
     * Uploads a locally built Debian package into the leios-archive repository.
     * Unlike {@link uploadAndVerifyIntoArchiveRepo}, this variant accepts a
     * filesystem path instead of a web {@link File} and reads metadata from the
     * package itself.
     *
     * @param debPath - Absolute path to the .deb file.
     * @returns Package metadata once it has been added to the archive repo.
     */
    export async function uploadLocalDebIntoArchiveRepo(debPath: string) {
        const dpkgInfo = await Bun.$`dpkg-deb -f ${debPath}`.text();

        const parseField = (name: string): string => {
            const match = dpkgInfo.match(new RegExp(`^${name}: (.*)$`, "m"));
            return match?.[1]?.trim() || "";
        };

        const packageName = parseField("Package");
        const packageVersion = parseField("Version");
        const packageArchitecture = parseField("Architecture") as AptlyAPI.Utils.Architectures;

        if (!packageName || !packageVersion || !packageArchitecture) {
            throw new Error(`Could not extract required metadata from ${debPath}`);
        }

        const existsPackage = await existsInRepo("leios-archive", packageName, packageVersion, packageArchitecture);
        if (existsPackage) {
            Logger.info(`Package ${packageName} ${packageVersion} ${packageArchitecture} already exists in archive repo; skipping upload.`);
            return { name: packageName, version: packageVersion, architecture: packageArchitecture };
        }

        const uploadSubDir = Bun.randomUUIDv7();
        const fileName = path.basename(debPath);
        const uploadDir = path.join(AptlyAPIServer.aptlyUploadDir, uploadSubDir);
        const fullFilePath = path.join(uploadDir, fileName);

        let shouldCleanup = true;

        await AptlyUtils.ensureDirExists(uploadDir);

        try {
            await fs.copyFile(debPath, fullFilePath);

            const addingResult = await AptlyAPI.Tasks.run(`add ${fileName} to leios-archive`, (query) =>
                AptlyAPIServer.getClient().postApiReposByNameFileByDirByFile({
                    path: {
                        name: "leios-archive",
                        dir: uploadSubDir,
                        file: fileName
                    },
                    query
                })
            );

            const parsedResult = (addingResult.data as any as { "Report": { "Added": string[] } })?.["Report"]?.["Added"]?.[0] || "";

            if (addingResult.error || !parsedResult.includes("added")) {
                throw new Error("Failed to add package to repository: " + addingResult.error);
            }

            shouldCleanup = false;
            Logger.info(`Uploaded ${packageName} ${packageVersion} ${packageArchitecture} into archive repo.`);
            return { name: packageName, version: packageVersion, architecture: packageArchitecture };
        } finally {
            if (shouldCleanup) {
                await fs.rm(uploadDir, { recursive: true, force: true });
            }
        }
    }

    export async function copyIntoRepo(targetRepo: "leios-stable" | "leios-testing", packageFullName: string, packageVersionWithLeiosPatch: string, packageArch: AptlyAPI.Utils.Architectures) {
        const packageIdentifier = AptlyUtils.getPackageIdentifier(packageFullName, packageVersionWithLeiosPatch, packageArch);

        const result = await AptlyAPI.Tasks.run(`copy ${packageIdentifier} to ${targetRepo}`, (query) =>
            AptlyAPIServer.getClient().postApiReposByNameCopyBySrcByFile({
                path: {
                    name: targetRepo,
                    src: "leios-archive",
                    file: packageIdentifier
                },
                query
            })
        );
        const parsedResult = (result.data as any as { "Report": { "Added": string[] } } | null)?.["Report"]?.["Added"]?.[0] || "error";

        if (result.error || !parsedResult.includes("added")) {
            throw new Error("Failed to copy package into repository: " + result.error);
        }
        return true;
    }

    /**
     * Removes packages from a repository. Packages nothing references any
     * more stay in aptly's database until the db cleanup at the end of the
     * next testing-repo:update task.
     */
    export async function deleteInRepo(repoName: AptlyAPI.Utils.Repos, packageFullName: string, packageVersionWithLeiosPatch?: string, packageArch?: AptlyAPI.Utils.Architectures) {
        const refs = await getRefInRepo(repoName, packageFullName, packageVersionWithLeiosPatch, packageArch);
        if (refs.length === 0) {
            return true;
        }

        const result = await AptlyAPI.Tasks.run(`remove ${packageFullName} from ${repoName}`, (query) =>
            AptlyAPIServer.getClient().deleteApiReposByNamePackages({
                body: {
                    PackageRefs: refs
                },
                path: {
                    name: repoName
                },
                query
            })
        );

        return (result.data && !result.error) ? true : false;
    }

    export async function deleteAllInAllRepos(packageFullName: string, packageVersionWithLeiosPatch?: string, packageArch?: AptlyAPI.Utils.Architectures) {
        let result = true;
        for (const repo of AptlyAPI.Utils.REPOS) {
            result = await deleteInRepo(repo, packageFullName, packageVersionWithLeiosPatch, packageArch) && result;
        }
        return result;
    }

}

export namespace AptlyAPI.Snapshots {

    export async function createSnapshotOfRepo(repoName: AptlyAPI.Utils.Repos, snapshotName: string, description?: string) {
        const snapshotResult = await AptlyAPI.Tasks.run(`create snapshot ${snapshotName}`, (query) =>
            AptlyAPIServer.getClient().postApiReposByNameSnapshots({
                path: {
                    name: "leios-stable"
                },
                body: {
                    Name: snapshotName,
                    Description: description || `Snapshot of ${repoName} created at ${new Date().toISOString()}`,
                },
                query
            })
        );
        return snapshotResult.error === null;
    }

    export async function createStableReleaseSnapshot(version: string) {
        const snapshotName = `leios-stable-${version}`;
        return createSnapshotOfRepo("leios-stable", snapshotName, `LeiOS Stable Release ${version}`);
    }

}

export namespace AptlyAPI.Publishing {

    // testing repo is updated continuously without snapshots
    export async function updateLiveTestingRepo() {
        const result = await AptlyAPI.Tasks.run("publish testing", (query) =>
            AptlyAPIServer.getClient().putApiPublishByPrefixByDistribution({
                path: {
                    prefix: "s3:leios-live-repo:",
                    distribution: "testing"
                },
                body: {
                    Signing: AptlyAPIServer.SigningConfig
                },
                query
            })
        );

        if (result.error !== null) {
            throw new Error("Failed to update live testing repository: " + result.error);
        }
    }

    export async function publishReleaseSnapshotToLiveStable(version: string) {
        const result = await AptlyAPI.Tasks.run(`publish stable from leios-stable-${version}`, (query) =>
            AptlyAPIServer.getClient().putApiPublishByPrefixByDistribution({
                path: {
                    prefix: `s3:leios-live-repo:`,
                    distribution: "stable"
                },
                body: {
                    Snapshots: [{
                        Name: `leios-stable-${version}`,
                        Component: "main"
                    }],
                    Signing: AptlyAPIServer.SigningConfig
                },
                query
            })
        );

        if (result.error !== null) {
            throw new Error("Failed to publish snapshot to S3: " + result.error);
        }

        return true;
    }

}

export namespace AptlyAPI.Packages.Models {

    export const PackageInfo = z.object({
        name: z.string(),
        key: z.string(),
        versionWithLeiosPatch: z.string(),
        architecture: z.enum(AptlyAPI.Utils.ARCHITECTURES),
        maintainer: z.string(),
        description: z.string(),
    });
    export type PackageInfo = z.infer<typeof PackageInfo>;

    export const getVersionInRepoResponse = z.object({
        "amd64": PackageInfo.optional(),
        "arm64": PackageInfo.optional(),
        "all": PackageInfo.optional()
    });
    export type getVersionInRepoResponse = z.infer<typeof getVersionInRepoResponse>;

    export const getAllInRepoResponse = z.record(
        z.string(),
        getVersionInRepoResponse
    );
    export type getAllInRepoResponse = z.infer<typeof getAllInRepoResponse>;

    export const getAllInAllReposResponse = z.object({
        "leios-archive": getAllInRepoResponse,
        "leios-testing": getAllInRepoResponse,
        "leios-stable": getAllInRepoResponse,
    });
    export type getAllInAllReposResponse = z.infer<typeof getAllInAllReposResponse>;

}

