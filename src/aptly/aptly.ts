import { AptlyAPIServer } from "./server";
import fs from 'fs';
import { dirname } from 'path';
import { AptlyUtils } from "./utils";

export namespace AptlyAPI.Utils {

    export const DEFAULT_REPOS = ["leios-stable", "leios-testing", "leios-archive"] as const;
    export type DefaultRepos = (typeof DEFAULT_REPOS)[number];

}

export namespace AptlyAPI.Packages {

    export async function getRefInRepo(repoName: AptlyAPI.Utils.DefaultRepos, packageName: string, packageVersion?: string, packageArch?: string) {
        return (await AptlyAPIServer.getClient().getApiReposByNamePackages({
            path: {
                name: repoName
            },
            query: {
                q: `Name (${packageName})` + (packageVersion ? `, Version (${packageVersion})` : "") + (packageArch ? `, Architecture (${packageArch})` : ""),
                withDeps: "",
                format: "",
                maximumVersion: ""
            }
        })).data as any as string[] || [];
    }

    export async function existsInRepo(repoName: AptlyAPI.Utils.DefaultRepos, packageName: string, packageVersion?: string, packageArch?: string) {
        const refs = await getRefInRepo(repoName, packageName, packageVersion, packageArch);
        return refs.length > 0;
    }

    export async function uploadAndVerify(
        repoName: AptlyAPI.Utils.DefaultRepos,
        packageData: {
            name: string;
            maintainerName: string;
            maintainerEmail: string;
            version: string;
            leiosPatchVersion?: number;
            architecture: string;
        },
        file: File,
        skipMaintainerCheck = false
    ) {
        const fullPackageVersion = AptlyUtils.buildVersionWithLeiOSSuffix(packageData.version, packageData.leiosPatchVersion);

        const existsPackage = await existsInRepo(repoName, packageData.name, fullPackageVersion, packageData.architecture);
        if (existsPackage) {
            throw new Error("Package already exists in repository.");
        }

        const uploadSubDir = Bun.randomUUIDv7();
        const packageIdentifier = `${packageData.name}_${fullPackageVersion}_${packageData.architecture}`;
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

        if (!skipMaintainerCheck && !dpkgChackResult.includes(`Maintainer: ${packageData.maintainerName} <${packageData.maintainerEmail}>`)) {
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

    export async function deleteInRepo(repoName: AptlyAPI.Utils.DefaultRepos, packageName: string, packageVersion?: string, packageArch?: string, doCleanup = true) {
        const refs = await getRefInRepo(repoName, packageName, packageVersion, packageArch);
        const result = await AptlyAPIServer.getClient().deleteApiReposByNamePackages({
            body: {
                PackageRefs: refs
            },
            path: {
                name: repoName
            }
        });
        return (result.data && !result.error) ? true : false;
    }

    export async function deleteAllInAllRepos(packageName: string) {
        let result = true;
        for (const repo of AptlyAPI.Utils.DEFAULT_REPOS) {
            result = await deleteInRepo(repo, packageName) && result;
        }
        return result;
    }

}