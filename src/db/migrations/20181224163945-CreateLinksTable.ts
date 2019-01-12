import { IMigration } from "../IMigration";
import { IPostgresTransaction } from "../postgres";
import { TABLE_ROOM_LINKS } from "../models/RoomLink";

export class CreateLinksTable implements IMigration {
    public id = "20181224163945";

    public async up(txn: IPostgresTransaction): Promise<any> {
        await txn.query(`
            CREATE TABLE IF NOT EXISTS ${TABLE_ROOM_LINKS} (
                id TEXT UNIQUE,
                from_id TEXT NOT NULL,
                from_type TEXT NOT NULL,
                to_id TEXT NOT NULL,
                to_type TEXT NOT NULL,
                kind TEXT NOT NULL,
                metadata TEXT NULL,
                created_ts BIGINT NOT NULL
            )
        `);
        await txn.query(`
            CREATE INDEX IF NOT EXISTS ${TABLE_ROOM_LINKS}_idx_from_id
            ON ${TABLE_ROOM_LINKS}(from_id)
        `);
        await txn.query(`
            CREATE INDEX IF NOT EXISTS ${TABLE_ROOM_LINKS}_idx_to_id
            ON ${TABLE_ROOM_LINKS}(to_id)
        `);
        await txn.query(`
            CREATE INDEX IF NOT EXISTS ${TABLE_ROOM_LINKS}_idx_kind
            ON ${TABLE_ROOM_LINKS}(kind)
        `);
    }
}