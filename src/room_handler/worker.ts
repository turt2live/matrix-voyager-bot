import { IWorker } from "../IWorker";
import { MqConnection } from "../mq/mq";
import { IRoomStatePayload, TOPIC_ROOM_STATE, TYPE_STATE_EVENT } from "../mq/consts";
import { RoomStateCalculator } from "./RoomStateCalculator";
import { now } from "../util";
import { LogService } from "matrix-js-snippets";
import { MatrixClient } from "matrix-bot-sdk";
import { VoyagerConfig } from "../VoyagerConfig";

const ROOM_UPDATE_INTERVAL = 30000; // 30 seconds

/**
 * Creates an room handler worker
 * @constructor
 */
export function NewRoomHandlerWorker(): RoomHandlerWorker {
    return new RoomHandlerWorker();
}

export class RoomHandlerWorker implements IWorker {

    private mq: MqConnection;
    private lastUpdated: { [roomId: string]: number } = {};

    constructor() {
        this.mq = new MqConnection();

        this.mq.on(TOPIC_ROOM_STATE, this.onRoomState.bind(this));
    }

    public async start(): Promise<any> {
        return this.mq.start();
    }

    private async onRoomState(payloadType: string, payload: IRoomStatePayload) {
        if (payloadType !== TYPE_STATE_EVENT) return;

        if (this.lastUpdated[payload.roomId] && (now() - this.lastUpdated[payload.roomId]) < ROOM_UPDATE_INTERVAL) {
            LogService.warn("RoomHandlerWorker", `Recently updated room ${payload.roomId} - not updating this time`);
            return;
        }

        LogService.info("RoomHandlerWorker", `Calculating new room state for ${payload.roomId}`);
        const stateCalculator = new RoomStateCalculator(payload.roomId);
        const state = await stateCalculator.getState();
        this.lastUpdated[payload.roomId] = now();

        return (new MatrixClient(VoyagerConfig.matrix.homeserverUrl, VoyagerConfig.appservice.asToken))
            .sendNotice(payload.roomId, `Calculated room state:\n\n${JSON.stringify(state, null, 2)}`);
    }

}