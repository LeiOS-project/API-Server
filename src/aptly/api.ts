import fs from "fs/promises";
import path from "path";
import { AptlyAPIServer } from "./server";
import { AptlyUtils } from "./utils";
import z from "zod";

export namespace AptlyAPI.Utils {

    export const REPOS = ["leios-stable", "leios-testing", "leios-archive"] as const;
    export type Repos = (typeof REPOS)[number];

    export const ARCHITECTURES = ["amd64", "arm64"] as const;
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

export namespace AptlyAPI.DB {

    export async function cleanup() {
        const result = await AptlyAPIServer.getClient().postApiDbCleanup();
        if (result.error) return false;
        return true;
    }

}

export namespace AptlyAPI.Packages {

    export async function getRefInRepo(repoName: AptlyAPI.Utils.Repos, packageName: string, packageVersionWithLeiosPatch?: string, packageArch?: AptlyAPI.Utils.Architectures) {
        const refsResult = await AptlyAPIServer.getClient().getApiReposByNamePackages({
            path: {
                name: repoName
            },
            query: {
                q: `Name (${packageName})` + (packageVersionWithLeiosPatch ? `, Version (${packageVersionWithLeiosPatch})` : "") + (packageArch ? `, Architecture (${packageArch})` : ""),
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

    export async function getInRepo(repoName: AptlyAPI.Utils.Repos, packageName: string, packageVersionWithLeiosPatch?: string, packageArch?: AptlyAPI.Utils.Architectures) {
        const result = await AptlyAPIServer.getClient().getApiReposByNamePackages({
            path: {
                name: repoName
            },
            query: {
                q: `Name (${packageName})` + (packageVersionWithLeiosPatch ? `, Version (${packageVersionWithLeiosPatch})` : "") + (packageArch ? `, Architecture (${packageArch})` : ""),
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

            if (pkg.Package !== packageName ||
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

    export async function getVersionInRepo(repoName: AptlyAPI.Utils.Repos, packageName: string, packageVersionWithLeiosPatch: string) {
        const pkgs = await getInRepo(repoName, packageName, packageVersionWithLeiosPatch);
        const returnData: {
            "amd64"?: AptlyAPI.Packages.Models.PackageInfo,
            "arm64"?: AptlyAPI.Packages.Models.PackageInfo
        } = {};
        
        for (const pkg of pkgs) {
            returnData[pkg.architecture] = pkg;
        }
        return returnData satisfies AptlyAPI.Packages.Models.getVersionInRepoResponse;
    }

    export async function getAllInRepo(repoName: AptlyAPI.Utils.Repos, packageName: string) {
        const pkgs = await getInRepo(repoName, packageName);
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

    export async function getAllInAllRepos(packageName: string) {
        const pkgsInArchive = await getAllInRepo("leios-archive", packageName);
        const pkgsInTesting = await getAllInRepo("leios-testing", packageName);
        const pkgsInStable = await getAllInRepo("leios-stable", packageName);

        return {
            "leios-archive": pkgsInArchive,
            "leios-testing": pkgsInTesting,
            "leios-stable": pkgsInStable,
        } satisfies AptlyAPI.Packages.Models.getAllInAllReposResponse;
    }

    export async function existsInRepo(repoName: AptlyAPI.Utils.Repos, packageName: string, packageVersionWithLeiosPatch?: string, packageArch?: AptlyAPI.Utils.Architectures) {
        const refs = await getRefInRepo(repoName, packageName, packageVersionWithLeiosPatch, packageArch);
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
            name: string;
            maintainer_name: string;
            maintainer_email: string;
            versionWithLeiosPatch: string;
            architecture: AptlyAPI.Utils.Architectures;
        },
        file: File,
        skipMaintainerCheck = false
    ) {
        const fullPackageVersion = AptlyUtils.buildVersionWithLeiOSSuffix(packageData.versionWithLeiosPatch);

        const existsPackage = await existsInRepo("leios-archive", packageData.name, packageData.versionWithLeiosPatch, packageData.architecture);
        if (existsPackage) {
            throw new Error("Package already exists in repository.");
        }

        const uploadSubDir = Bun.randomUUIDv7();
        const packageIdentifier = AptlyUtils.getPackageIdentifier(packageData.name, fullPackageVersion, packageData.architecture);
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
                { description: "Uploaded package name mismatch.", ok: dpkgCheckResult.includes(`Package: ${packageData.name}`) },
                {
                    description: "Uploaded package maintainer mismatch.",
                    ok: skipMaintainerCheck || dpkgCheckResult.includes(`Maintainer: ${packageData.maintainer_name} <${packageData.maintainer_email}>`)
                }
            ];

            const failedValidation = validations.find(v => !v.ok);
            if (failedValidation) {
                throw new Error(failedValidation.description);
            }

            const addingResult = await AptlyAPIServer.getClient().postApiReposByNameFileByDirByFile({
                path: {
                    name: "leios-archive",
                    dir: uploadSubDir,
                    file: fileName
                }
            });

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

    export async function copyIntoRepo(targetRepo: "leios-stable" | "leios-testing", packageName: string, packageVersionWithLeiosPatch: string, packageArch: AptlyAPI.Utils.Architectures) {
        
        const result = await AptlyAPIServer.getClient().postApiReposByNameCopyBySrcByFile({
            path: {
                name: targetRepo,
                src: "leios-archive",
                file: AptlyUtils.getPackageIdentifier(packageName, packageVersionWithLeiosPatch, packageArch)
            }
        });
        const parsedResult = (result.data as any as { "Report": { "Added": string[] } })["Report"]["Added"][0] || "error";

        if (result.error || !parsedResult.includes("added")) {
            throw new Error("Failed to copy package into repository: " + result.error);
        }
        return true;
    }

    export async function deleteInRepo(repoName: AptlyAPI.Utils.Repos, packageName: string, packageVersionWithLeiosPatch?: string, packageArch?: AptlyAPI.Utils.Architectures, doCleanup = true) {
        const refs = await getRefInRepo(repoName, packageName, packageVersionWithLeiosPatch, packageArch);
        const result = await AptlyAPIServer.getClient().deleteApiReposByNamePackages({
            body: {
                PackageRefs: refs
            },
            path: {
                name: repoName
            }
        });

        if (doCleanup) {
            await AptlyAPI.DB.cleanup();
        }

        return (result.data && !result.error) ? true : false;
    }

    export async function deleteAllInAllRepos(packageName: string, packageVersionWithLeiosPatch?: string, packageArch?: AptlyAPI.Utils.Architectures) {
        let result = true;
        for (const repo of AptlyAPI.Utils.REPOS) {
            result = await deleteInRepo(repo, packageName, packageVersionWithLeiosPatch, packageArch, false) && result;
        }
        await AptlyAPI.DB.cleanup();
        return result;
    }

}

export namespace AptlyAPI.Snapshots {

    export async function createSnapshotOfRepo(repoName: AptlyAPI.Utils.Repos, snapshotName: string, description?: string) {
        const snapshotResult = await AptlyAPIServer.getClient().postApiReposByNameSnapshots({
            path: {
                name: "leios-stable"
            },
            body: {
                Name: snapshotName,
                Description: description || `Snapshot of ${repoName} created at ${new Date().toISOString()}`,
            }
        });
        return snapshotResult.data !== null;
    }

    export async function createStableReleaseSnapshot(version: string) {
        const snapshotName = `leios-stable-${version}`;
        return createSnapshotOfRepo("leios-stable", snapshotName, `LeiOS Stable Release ${version}`);
    }

}

export namespace AptlyAPI.Publishing {

    // testing repo is updated continuously without snapshots
    export async function updateLiveTestingRepo() {
        const result = await AptlyAPIServer.getClient().putApiPublishByPrefixByDistribution({
            path: {
                prefix: "s3:leios-live-repo:",
                distribution: "testing"
            },
            body: {
                Signing: AptlyAPIServer.SigningConfig
            }
        });

        if (!result.data) {
            throw new Error("Failed to update live testing repository: " + result.error.error);
        }
    }

    export async function publishReleaseSnapshotToLiveStable(version: string) {
        const result = await AptlyAPIServer.getClient().putApiPublishByPrefixByDistribution({
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
            }
        });

        if (!result.data) {
            throw new Error("Failed to publish snapshot to S3: " + result.error.error);
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
        "arm64": PackageInfo.optional()
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

