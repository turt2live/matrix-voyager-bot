export const TYPE_STATE_EVENT = "io.t2l.voyager.state_event";
export const TYPE_CREATE_LINK = "io.t2l.voyager.create_link";

export const TOPIC_ROOM_STATE = "voyager.room_state";
export const TOPIC_LINKS = "voyager.links";

export interface IRoomStatePayload {
    roomId: string;
    event: any;
}

export interface IEntity {
    type: "user" | "room";
    id: string;
}

export interface ICreateLink {
    from: IEntity;
    to: IEntity;
    type: "invite" | "message" | "kick" | "ban" | "leave";
    message?: string;
}