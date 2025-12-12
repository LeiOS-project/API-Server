import { Logger } from "../utils/logger";

export class LiveRepoUtils {

    static async uploadAdditionalFilesIfNeeded(
        s3Options: {
            endpoint: string;
            region: string;
            bucket: string;
            prefix?: string;
            accessKeyId: string;
            secretAccessKey: string;
        },
        publicKeyPath: string
    ) {
        const s3Client = new Bun.S3Client({
            endpoint: s3Options.endpoint,
            region: s3Options.region,
            bucket: s3Options.bucket,
            accessKeyId: s3Options.accessKeyId,
            secretAccessKey: s3Options.secretAccessKey,
        });

        Logger.info("Uploading additional repository files to S3 if they do not already exist...");

        await this.uploadFileToS3IfNotExists(
            s3Client,
            "public-key.gpg",
            publicKeyPath,
            s3Options.prefix
        );

        await this.uploadFileToS3IfNotExists(
            s3Client,
            "index.html",
            "./assets/repo-index.html",
            s3Options.prefix
        );

    }

    private static async uploadFileToS3IfNotExists(s3Client: Bun.S3Client, key: string, filePath: string, prefix?: string) {
        
        const fullPath = prefix ? prefix.endsWith("/") ? `${prefix}${key}` : `${prefix}/${key}` : key;

        if (!await s3Client.exists(fullPath)) {
            await s3Client.write(fullPath, Bun.file(filePath));
            Logger.info(`Uploaded ${key} to S3`);
        }
    }

}
