import { AptlyAPIServer } from "./server";
import fs from 'fs';
import { dirname } from 'path';
import { AptlyUtils } from "./utils";
import z from "zod";

export namespace AptlyAPI.Utils {

    export const REPOS = ["leios-stable", "leios-testing", "leios-archive"] as const;
    export type Repos = (typeof REPOS)[number];

    export const ARCHITECTURES = ["amd64", "arm64"] as const;
    export type Architectures = (typeof ARCHITECTURES)[number];

}

export namespace AptlyAPI.DB {

    export async function cleanup() {
        const result = await AptlyAPIServer.getClient().postApiDbCleanup();
        if (result.error) return false;
        return true;
    }

}

export namespace AptlyAPI.Packages {

    export async function getRefInRepo(repoName: AptlyAPI.Utils.Repos, packageName: string, packageVersion?: string, leios_patch?: string, packageArch?: AptlyAPI.Utils.Architectures) {
        const fullPackageVersion = packageVersion ? AptlyUtils.buildVersionWithLeiOSSuffix(packageVersion, leios_patch) : undefined;
        return (await AptlyAPIServer.getClient().getApiReposByNamePackages({
            path: {
                name: repoName
            },
            query: {
                q: `Name (${packageName})` + (fullPackageVersion ? `, Version (${fullPackageVersion})` : "") + (packageArch ? `, Architecture (${packageArch})` : ""),
                withDeps: "",
                format: "",
                maximumVersion: ""
            }
        })).data as any as string[] || [];
    }

    export async function getInRepo(repoName: AptlyAPI.Utils.Repos, packageName: string, packageVersion?: string, leios_patch?: string, packageArch?: AptlyAPI.Utils.Architectures) {
        const fullPackageVersion = packageVersion ? AptlyUtils.buildVersionWithLeiOSSuffix(packageVersion, leios_patch) : undefined;
        const reuslt = (await AptlyAPIServer.getClient().getApiReposByNamePackages({
            path: {
                name: repoName
            },
            query: {
                q: `Name (${packageName})` + (fullPackageVersion ? `, Version (${fullPackageVersion})` : "") + (packageArch ? `, Architecture (${packageArch})` : ""),
                withDeps: "",
                format: "details",
                maximumVersion: ""
            }
        }));
        if (reuslt.error) {
            throw new Error("Failed to get package: " + reuslt.error);
        }
        const resultData = reuslt.data as any;

        if (!Array.isArray(resultData)) {
            throw new Error("Invalid response from Aptly server.");
        }

        const returnedPackages: Array<AptlyAPI.Packages.Models.PackageInfo> = [];

        for (const pkg of resultData) {

            if (typeof pkg !== 'object') {
                throw new Error("Invalid package data from Aptly server.");
            }

            if (pkg.Package !== packageName || 
                (fullPackageVersion && pkg.Version !== fullPackageVersion) ||
                (packageArch && pkg.Architecture !== packageArch)) {
                throw new Error("Package data mismatch from Aptly server.");
            }

            const versionInfo = AptlyUtils.extractVersionAndPatchSuffix(pkg.Version);

            returnedPackages.push({
                name: pkg.Package as string,
                key: pkg.Key as string,
                version: versionInfo.version as string,
                leios_patch: versionInfo.leios_patch as string | undefined,
                architecture: pkg.Architecture as AptlyAPI.Utils.Architectures,
                maintainer: pkg.Maintainer as string,
                description: pkg.Description as string,
            });
        }

        return returnedPackages;
    }

    export async function getVersionInRepo(repoName: AptlyAPI.Utils.Repos, packageName: string, packageVersion: string, leios_patch?: string) {
        const pkgs = await getInRepo(repoName, packageName, packageVersion, leios_patch);
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
            [version: string]: {
                "amd64"?: AptlyAPI.Packages.Models.PackageInfo,
                "arm64"?: AptlyAPI.Packages.Models.PackageInfo
            }
        } = {};

        for (const pkg of pkgs) {
            if (!returnData[pkg.version]) {
                returnData[pkg.version] = {};
            }
            returnData[pkg.version][pkg.architecture] = pkg;
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

    export async function existsInRepo(repoName: AptlyAPI.Utils.Repos, packageName: string, packageVersion?: string, leios_patch?: string, packageArch?: AptlyAPI.Utils.Architectures) {
        const refs = await getRefInRepo(repoName, packageName, packageVersion, leios_patch, packageArch);
        return refs.length > 0;
    }

    export async function uploadAndVerify(
        repoName: AptlyAPI.Utils.Repos,
        packageData: {
            name: string;
            maintainer_name: string;
            maintainer_email: string;
            version: string;
            leios_patch?: string;
            architecture: AptlyAPI.Utils.Architectures;
        },
        file: File,
        skipMaintainerCheck = false
    ) {
        const fullPackageVersion = AptlyUtils.buildVersionWithLeiOSSuffix(packageData.version, packageData.leios_patch);

        const existsPackage = await existsInRepo(repoName, packageData.name, packageData.version, packageData.leios_patch, packageData.architecture);
        if (existsPackage) {
            throw new Error("Package already exists in repository.");
        }

        const uploadSubDir = Bun.randomUUIDv7();
        const packageIdentifier = AptlyUtils.getPackageIdentifier(packageData.name, fullPackageVersion, packageData.architecture);
        const fileName = `${packageIdentifier}.deb`;
        const fullFilePath = AptlyAPIServer.aptlyUploadDir + "/" + uploadSubDir + "/" + fileName;

        await Bun.write(fullFilePath, await file.arrayBuffer());

        const dpkgChackResult = await Bun.$`dpkg --info ${fullFilePath}`.text();

        if (!dpkgChackResult.includes(`Version: ${fullPackageVersion}`)) {
            fs.rmSync(dirname(fullFilePath), { recursive: true, force: true });
            throw new Error("Uploaded package version mismatch.");
        }

        if (!dpkgChackResult.includes(`Architecture: ${packageData.architecture}`)) {
            fs.rmSync(dirname(fullFilePath), { recursive: true, force: true });
            throw new Error("Uploaded package architecture mismatch.");
        }

        if (!dpkgChackResult.includes(`Package: ${packageData.name}`)) {
            fs.rmSync(dirname(fullFilePath), { recursive: true, force: true });
            throw new Error("Uploaded package name mismatch.");
        }

        if (!skipMaintainerCheck && !dpkgChackResult.includes(`Maintainer: ${packageData.maintainer_name} <${packageData.maintainer_email}>`)) {
            fs.rmSync(dirname(fullFilePath), { recursive: true, force: true });
            throw new Error("Uploaded package maintainer mismatch.");
        }

        const addingResult = await AptlyAPIServer.getClient().postApiReposByNameFileByDirByFile({
            path: {
                name: repoName,
                dir: uploadSubDir,
                file: fileName
            }
        });

        const parsedResult = (addingResult.data as any as { "Report": { "Added": string[] } })["Report"]["Added"][0] || "error";

        if (addingResult.error || parsedResult !== `${packageIdentifier} added`) {

            fs.rmSync(dirname(fullFilePath), { recursive: true, force: true });

            throw new Error("Failed to add package to repository: " + addingResult.error);
        }

        return true;
    }

    export async function copyIntoRepo(targetRepo: "leios-stable" | "leios-testing", packageName: string, packageVersion: string, leios_patch: string | undefined, packageArch: AptlyAPI.Utils.Architectures) {
        const result = await AptlyAPIServer.getClient().postApiReposByNameCopyBySrcByFile({
            path: {
                name: targetRepo,
                src: "leios-archive",
                file: AptlyUtils.getPackageIdentifier(packageName, packageVersion, leios_patch, packageArch)
            }
        });
        const parsedResult = (result.data as any as { "Report": { "Added": string[] } })["Report"]["Added"][0] || "error";

        if (result.error || !parsedResult.includes("added")) {
            throw new Error("Failed to copy package into repository: " + result.error);
        }
        return true;
    }

    export async function deleteInRepo(repoName: AptlyAPI.Utils.Repos, packageName: string, packageVersion?: string, leios_patch?: string, packageArch?: AptlyAPI.Utils.Architectures, doCleanup = true) {
        const refs = await getRefInRepo(repoName, packageName, packageVersion, leios_patch, packageArch);
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

    export async function deleteAllInAllRepos(packageName: string, packageVersion?: string, leios_patch?: string, packageArch?: AptlyAPI.Utils.Architectures) {
        let result = true;
        for (const repo of AptlyAPI.Utils.REPOS) {
            result = await deleteInRepo(repo, packageName, packageVersion, leios_patch, packageArch, false) && result;
        }
        await AptlyAPI.DB.cleanup();
        return result;
    }

}

export namespace AptlyAPI.Packages.Models {

    export const PackageInfo = z.object({
        name: z.string(),
        key: z.string(),
        version: z.string(),
        leios_patch: z.string().optional(),
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

