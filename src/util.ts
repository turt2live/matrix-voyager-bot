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