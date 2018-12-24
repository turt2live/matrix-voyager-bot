export const TABLE_ROOM_SNAPSHOTS = "room_snapshots";
export const TABLE_CURRENT_ROOM_SNAPSHOTS = "room_snapshot_current";

export interface IRoomSnapshot {
    id: string;
    room_id: string;
    friendly_id: string;
    display_name: string;
    avatar_mxc: string;
    is_public: boolean;
    num_users: number;
    num_servers: number;
    num_aliases: number;
    captured_ts: number;
}

export interface ICurrentRoomSnapshot {
    room_id: string;
    friendly_id: string;
    display_name: string;
    avatar_mxc: string;
    is_public: boolean;
    num_users: number;
    num_servers: number;
    num_aliases: number;
}