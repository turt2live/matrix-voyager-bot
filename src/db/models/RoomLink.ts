export const TABLE_ROOM_LINKS = "room_links";

export interface IRoomLink {
    id: string;
    from_id: string;
    from_type: string;
    to_id: string;
    to_type: string;
    kind: string;
    metadata: string;
    created_ts: number;
}