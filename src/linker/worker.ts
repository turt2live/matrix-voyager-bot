import { IWorker } from "../IWorker";
import { MqConnection } from "../mq/mq";
import { PostgresDatabase } from "../db/postgres";
import { ICreateLink, IRoomUpdated, TOPIC_LINKS, TYPE_CREATE_LINK, TYPE_ROOM_UPDATED } from "../mq/consts";
import { IRoomLink, TABLE_ROOM_LINKS } from "../db/models/RoomLink";
import { now } from "../util";
import * as sha512 from "hash.js/lib/hash/sha/512";
import { GraphData } from "./GraphData";
import { LogService } from "matrix-js-snippets";
import { MatrixClient } from "matrix-bot-sdk";
import { VoyagerConfig } from "../VoyagerConfig";

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
    private graph: GraphData;

    constructor() {
        this.mq = new MqConnection();

        this.mq.on(TOPIC_LINKS, this.onLink.bind(this));
    }

    public async start(): Promise<any> {
        return Promise.all([
            this.mq.start(),
            this.db.start(),
        ]).then(() => {
            this.graph = new GraphData(this.db);
            return this.graph.loadData();
        });
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

            LogService.info("LinkerWorker", `Updating graph with link of type ${linkInfo.type}`);
            await this.graph.handleLink(linkInfo);
        } else if (payloadType === TYPE_ROOM_UPDATED) {
            const roomId = (<IRoomUpdated>payload).roomId;
            LogService.info("LinkerWorker", `Updating graph with link for room ${roomId}`);
            await this.graph.updateRoom(roomId);
        }

        await (new MatrixClient(VoyagerConfig.matrix.homeserverUrl, VoyagerConfig.appservice.asToken))
            .sendNotice("!VLJKJUOcAMRSxfYWFH:dev.t2bot.io", "Updated condensed graph: \n\n" + JSON.stringify(this.graph.condense()));
    }
}
