import VoyagerBot from "../matrix/default_client";
import { LogService } from "matrix-js-snippets";
import * as Promise from "bluebird";

// Note: The schedule must not have duplicate values to avoid problems in positioning.
const SCHEDULE = [
    0,              // Right away
    1000,           // 1 second
    30 * 1000,      // 30 seconds
    5 * 60 * 1000,  // 5 minutes
    15 * 60 * 1000, // 15 minutes
];

export default function joinRoom(roomIdOrAlias: string): Promise<string> {
    let currentSchedule = SCHEDULE[0];

    LogService.info("join_strategy", "Starting join for " + roomIdOrAlias);

    const doJoin = () => waitPromise(currentSchedule).then(() => VoyagerBot.joinRoom(roomIdOrAlias));
    const errorHandler = err => {
        LogService.error("join_strategy", err);
        const idx = SCHEDULE.indexOf(currentSchedule);
        if (idx === SCHEDULE.length - 1) {
            LogService.warn("join_strategy", "Failed to join room " + roomIdOrAlias + " after the retry schedule - giving up.");
            return Promise.reject(err);
        } else {
            currentSchedule = SCHEDULE[idx + 1];
            return doJoin().catch(errorHandler);
        }
    };

    return doJoin().catch(errorHandler);
}

function waitPromise(interval: number): Promise<any> {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, interval);
    });
}