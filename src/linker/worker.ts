import { IWorker } from "../IWorker";
import { MqConnection } from "../mq/mq";
import { PostgresDatabase } from "../db/postgres";
import { ICreateLink, IRoomUpdated, TOPIC_LINKS, TYPE_CREATE_LINK, TYPE_ROOM_UPDATED } from "../mq/consts";
import { IRoomLink, TABLE_ROOM_LINKS } from "../db/models/RoomLink";
import { now } from "../util";
import * as sha512 from "hash.js/lib/hash/sha/512";

/**
 * Creates a new linker worker
 * @constructor
 */
export function NewLinkerWorker(): LinkerWorker {
    return new LinkerWorker();
}

export class LinkerWorker implements IWorker {

    private mq: MqConnection;
    private db = new PostgresDatabase();

    constructor() {
        this.mq = new MqConnection();

        this.mq.on(TOPIC_LINKS, this.onLink.bind(this));
    }

    public async start(): Promise<any> {
        return Promise.all([
            this.mq.start(),
            this.db.start(),
        ]);
    }

    private async onLink(payloadType: string, payload: ICreateLink | IRoomUpdated) {
        if (payloadType === TYPE_CREATE_LINK) {
            const linkInfo = <ICreateLink>payload;

            const createdTs = now();
            const link: IRoomLink = {
                id: "NOT_SET_YET",
                from_id: linkInfo.from.id,
                from_type: linkInfo.from.type,
                to_id: linkInfo.to.id,
                to_type: linkInfo.to.type,
                kind: linkInfo.type,
                metadata: linkInfo.message,
                created_ts: createdTs,
            };
            link.id = sha512().update(`${createdTs}${JSON.stringify(link)}`).digest('hex');

            await this.db.insert(TABLE_ROOM_LINKS, link);
        } else if (payloadType === TYPE_ROOM_UPDATED) {
            console.log(payload);
        }
    }
}
