import { IMigration } from "../IMigration";
import { IPostgresTransaction } from "../postgres";
import { TABLE_CURRENT_ROOM_SNAPSHOTS, TABLE_ROOM_SNAPSHOTS } from "../models/RoomSnapshot";

export class CreateRoomSnapshotsTable implements IMigration {
    public id = "20181224105745";

    public async up(txn: IPostgresTransaction): Promise<any> {
        await txn.query(`
            CREATE TABLE IF NOT EXISTS ${TABLE_ROOM_SNAPSHOTS} (
                id TEXT UNIQUE,
                room_id TEXT NOT NULL,
                friendly_id TEXT NOT NULL,
                display_name TEXT NOT NULL,
                avatar_mxc TEXT NOT NULL,
                is_public BOOL NOT NULL,
                num_users INTEGER NOT NULL,
                num_servers INTEGER NOT NULL,
                num_aliases INTEGER NOT NULL,
                captured_ts BIGINT NOT NULL
            )
        `);
        await txn.query(`
            CREATE INDEX IF NOT EXISTS ${TABLE_ROOM_SNAPSHOTS}_idx_room_id 
            ON ${TABLE_ROOM_SNAPSHOTS}(room_id)
        `);
        await txn.query(`
            CREATE INDEX IF NOT EXISTS ${TABLE_ROOM_SNAPSHOTS}_idx_captured_ts
            ON ${TABLE_ROOM_SNAPSHOTS}(captured_ts DESC)
        `);
        await txn.query(`
            CREATE TABLE IF NOT EXISTS ${TABLE_CURRENT_ROOM_SNAPSHOTS} (
                room_id TEXT NOT NULL UNIQUE,
                friendly_id TEXT NOT NULL,
                display_name TEXT NOT NULL,
                avatar_mxc TEXT NOT NULL,
                is_public BOOL NOT NULL,
                num_users INTEGER NOT NULL,
                num_servers INTEGER NOT NULL,
                num_aliases INTEGER NOT NULL
            )
        `);
    }
}