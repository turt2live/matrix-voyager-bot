import { IWorker } from "../IWorker";
import { MqConnection } from "../mq/mq";
import {
    IRoomStatePayload,
    IRoomUpdated,
    TOPIC_LINKS,
    TOPIC_ROOM_STATE,
    TYPE_ROOM_UPDATED,
    TYPE_STATE_EVENT
} from "../mq/consts";
import { RoomStateCalculator } from "./RoomStateCalculator";
import { now, simpleDiff } from "../util";
import { LogService } from "matrix-bot-sdk";
import { PostgresDatabase } from "../db/postgres";
import * as sha512 from "hash.js/lib/hash/sha/512";
import {
    ICurrentRoomSnapshot,
    IRoomSnapshot,
    TABLE_CURRENT_ROOM_SNAPSHOTS,
    TABLE_ROOM_SNAPSHOTS
} from "../db/models/RoomSnapshot";

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
    private db = new PostgresDatabase();
    private lastUpdated: { [roomId: string]: number } = {};
    private inProgress: { [roomId: string]: boolean } = {};

    constructor() {
        this.mq = new MqConnection();

        this.mq.on(TOPIC_ROOM_STATE, this.onRoomState.bind(this));
    }

    public async start(): Promise<any> {
        return Promise.all([
            this.mq.start(),
            this.db.start(),
        ]);
    }

    private async onRoomState(payloadType: string, payload: IRoomStatePayload) {
        if (payloadType !== TYPE_STATE_EVENT) return;

        if (this.inProgress[payload.roomId]) {
            LogService.warn("RoomHandlerWorker", `Already have a state update request in progress for ${payload.roomId} - ignoring`);
            return;
        }

        if (this.lastUpdated[payload.roomId] && (now() - this.lastUpdated[payload.roomId]) < ROOM_UPDATE_INTERVAL) {
            LogService.warn("RoomHandlerWorker", `Recently updated room ${payload.roomId} - not updating this time`);
            return;
        }

        LogService.info("RoomHandlerWorker", `Calculating new room state for ${payload.roomId}`);
        this.inProgress[payload.roomId] = true;
        const stateCalculator = new RoomStateCalculator(payload.roomId);
        const state = await stateCalculator.getState();
        this.lastUpdated[payload.roomId] = now();
        delete this.inProgress[payload.roomId];

        const existingSnapshot = await this.db.selectOne<ICurrentRoomSnapshot>(TABLE_CURRENT_ROOM_SNAPSHOTS, {room_id: state.id});

        const currentSnapshot: ICurrentRoomSnapshot = {
            room_id: state.id,
            friendly_id: state.friendlyId,
            display_name: state.displayName,
            avatar_mxc: state.avatarMxc,
            is_public: state.isPublic,
            num_users: state.numUsers,
            num_servers: state.numServers,
            num_aliases: state.numAliases,
        };

        if (existingSnapshot) {
            const diff = simpleDiff(existingSnapshot, currentSnapshot);
            if (!diff.length) {
                LogService.info("RoomHandlerWorker", `No significant change in state for ${payload.roomId}`);
                return;
            }
        }

        const createdTs = now();
        const key = sha512().update(`${createdTs}${JSON.stringify(state)}`).digest('hex');
        const snapshot: IRoomSnapshot = Object.assign({id: key, captured_ts: createdTs}, currentSnapshot);

        const txn = await this.db.startTransaction();
        try {
            await txn.insert(TABLE_ROOM_SNAPSHOTS, snapshot);
            await txn.upsert(TABLE_CURRENT_ROOM_SNAPSHOTS, "room_id", currentSnapshot);
            await txn.commitTransaction();
        } catch (e) {
            LogService.error("RoomHandlerWorker", e);
            await txn.rollbackTransaction();
        } finally {
            txn.release();
        }

        await this.mq.sendPayload(TOPIC_LINKS, TYPE_ROOM_UPDATED, <IRoomUpdated>{
            roomId: state.id,
            currentSnapshot: snapshot,
        });
    }

}