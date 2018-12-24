import { LogService } from "matrix-js-snippets";
import * as request from "request";

export async function downloadFromUrl(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
        request({
            method: "GET",
            url: url,
            encoding: null,
        }, (err, res, _body) => {
            if (err) {
                LogService.error("utils", "Error downloading file from " + url);
                LogService.error("utils", err);
                reject(err);
            } else if (res.statusCode !== 200) {
                LogService.error("utils", "Got status code " + res.statusCode + " while calling url " + url);
                reject(new Error("Error in request: invalid status code"));
            } else {
                resolve(res.body);
            }
        });
    });
}

export function now(): number {
    return (new Date()).getTime();
}

export function simpleDiff(a: any, ...b: any[]): string[] {
    const all = [a, ...b];
    const mismatchProperties = [];

    for (let i = 0; i < all.length; i++) {
        for (let j = 0; j < all.length; j++) {
            if (i === j) continue;

            const sideA = all[i];
            const sideB = all[j];

            for (const aKey of Object.keys(sideA)) {
                // noinspection JSUnfilteredForInLoop
                if (sideB[aKey] !== sideA[aKey]) {
                    mismatchProperties.push(aKey);
                }
            }

            for (const bKey of Object.keys(sideB)) {
                // noinspection JSUnfilteredForInLoop
                if (sideB[bKey] !== sideA[bKey]) {
                    mismatchProperties.push(bKey);
                }
            }
        }
    }

    return mismatchProperties.filter((p, i) => mismatchProperties.indexOf(p) === i);
}