import { IWorker } from "../IWorker";
import { MqConnection } from "../mq/mq";
import { IRoomStatePayload, TOPIC_ROOM_STATE } from "../mq/consts";

/**
 * Creates an room handler worker
 * @constructor
 */
export function NewRoomHandlerWorker(): RoomHandlerWorker {
    return new RoomHandlerWorker();
}

export class RoomHandlerWorker implements IWorker {

    private mq: MqConnection;

    constructor() {
        this.mq = new MqConnection();

        this.mq.on(TOPIC_ROOM_STATE, this.onRoomState.bind(this));
    }

    public async start(): Promise<any> {
        return this.mq.start();
    }

    private onRoomState(payloadType: string, payload: IRoomStatePayload) {
        console.log(payloadType);
        console.log(payload);
    }

}