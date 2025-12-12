
export class OSReleaseUtils {

    static getVersionString(date: Date, lastRelease = "0000.00.00") {

        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');

        let releaseNumberThisMonth = 1;
        if (lastRelease.startsWith(`${year}.${month}.`)) {
            const lastReleaseNumberThisMonth = parseInt(lastRelease.split(".")[2], 10);
            releaseNumberThisMonth = lastReleaseNumberThisMonth + 1;
        }

        return `${year}.${month}.${String(releaseNumberThisMonth).padStart(2, '0')}`;
    }

}
