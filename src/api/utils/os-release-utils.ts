import { Logger } from "../../utils/logger";

export class OSReleaseUtils {

    static getVersionString(date: Date, lastRelease = "0000.00.000") {

        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');

        let releaseNumberThisMonth = 1;
        if (lastRelease.startsWith(`${year}.${month}.`)) {

            const lastReleaseParts = lastRelease.split(".") as [string, string, string];
            
            if (lastReleaseParts.length !== 3) {
                Logger.error("Invalid last release format:", lastRelease);
                return `${year}.${month}.${String(releaseNumberThisMonth)}`;
            }

            const lastReleaseNumberThisMonth = parseInt(lastReleaseParts[2], 10);
            releaseNumberThisMonth = lastReleaseNumberThisMonth + 1;
        }

        return `${year}.${month}.${String(releaseNumberThisMonth).padStart(3, '0')}`;
    }

}
