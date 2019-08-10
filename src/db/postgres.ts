import { Client, Pool } from "pg";
import { VoyagerConfig } from "../VoyagerConfig";
import { KNOWN_MIGRATIONS } from "./IMigration";
import { LogService } from "matrix-bot-sdk";

export interface IPostgresTransaction {
    query<T>(statement: string, args?: any[]): Promise<T[]>;

    selectAll<T>(tableName: string, where?: any, limit?: number): Promise<T[]>;

    selectOne<T>(tableName: string, where?: any): Promise<T>;

    insert<T>(tableName: string, obj: T): Promise<T>;

    update<T>(tableName: string, idName: string, obj: T): Promise<T>;

    upsert<T>(tableName: string, idName: string, obj: T): Promise<T>;

    commitTransaction(): Promise<any>;

    rollbackTransaction(): Promise<any>;

    release(): void;
}

export class PostgresDatabase implements IPostgresTransaction {

    private pool: Pool;

    constructor(private client?: Client) {
    }

    /**
     * Starts the postgres database connection
     * @returns {Promise<*>} resolves when started
     */
    public async start(): Promise<any> {
        this.pool = new Pool({
            connectionString: VoyagerConfig.data.postgres,
            ssl: {
                rejectUnauthorized: false,
            },
        });
        return this.migrateUp();
    }

    private async getClient(): Promise<{ client: Client, shouldRelease: boolean }> {
        if (this.client) return {client: this.client, shouldRelease: false};
        return {client: await this.pool.connect(), shouldRelease: true};
    }

    public async migrateUp(): Promise<any> {
        await this.query("CREATE TABLE IF NOT EXISTS migrations (id TEXT NOT NULL)");
        const rows = await this.query<{ id: string }>("SELECT id FROM migrations");
        const migrations = rows.map(r => r.id);
        const toRun = KNOWN_MIGRATIONS.filter(i => migrations.indexOf(i.id) === -1);
        LogService.info("PostgresDatabase", `Running ${toRun.length} migrations`);

        for (const migration of toRun) {
            const txn = await this.startTransaction();
            try {
                await migration.up(txn);
                await txn.insert("migrations", {id: migration.id});
                await txn.commitTransaction();
            } catch (e) {
                LogService.error("PostgresDatabase", e);
                await txn.rollbackTransaction();
                throw e;
            } finally {
                txn.release();
            }
        }
    }

    public async query<T>(statement: string, args?: any[]): Promise<T[]> {
        LogService.info("PostgresDatabase", `Running query: ${statement}`);
        const pgClient = await this.getClient();
        try {
            return (await pgClient.client.query(statement, args)).rows;
        } finally {
            if (pgClient.shouldRelease) pgClient.client.release();
        }
    }

    public async selectAll<T>(tableName: string, where?: any, limit?: number): Promise<T[]> {
        let whereString = "";
        let args = [];
        if (where) {
            const columns = Object.keys(where);
            whereString = `WHERE ${columns.map((k, i) => `${k}=$${i + 1}`).join(" AND ")}`;
            args = columns.map(k => where[k]);
        }

        const limitString = limit ? `LIMIT ${limit}` : "";

        return this.query<T>(`SELECT * FROM ${tableName} ${whereString} ${limitString}`, args);
    }

    public async selectOne<T>(tableName: string, where?: any): Promise<T> {
        return (await this.selectAll<T>(tableName, where, 1))[0];
    }

    public async insert<T>(tableName: string, obj: T): Promise<T> {
        const columns = Object.keys(obj);
        const varString = columns.map((_, i) => `$${i + 1}`).join(", ");
        const varValues = columns.map(k => obj[k]);
        const result = this.query<T>(`INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${varString}) RETURNING *`, varValues);
        return result[0];
    }

    public async update<T>(tableName: string, idName: string, obj: T): Promise<T> {
        const columns = Object.keys(obj).filter(k => k !== idName);
        const updateStr = columns.map((c, i) => `${c}=$${i + 1}`).join(', ');
        const varValues = [...columns.map(k => obj[k]), obj[idName]];
        const result = this.query<T>(`UPDATE ${tableName} SET ${updateStr} WHERE ${idName}=$${varValues.length} RETURNING *`, varValues);
        return result[0];
    }

    public async upsert<T>(tableName: string, idName: string, obj: T): Promise<T> {
        const columns = Object.keys(obj).filter(k => k !== idName);
        const updateStr = columns.map((c, i) => `${c}=$${i + 1}`).join(', ');
        const varString = [...columns, idName].map((_, i) => `$${i + 1}`).join(", ");
        const varValues = [...columns.map(k => obj[k]), obj[idName]];
        const result = this.query<T>(`INSERT INTO ${tableName} (${[...columns, idName].join(", ")}) VALUES (${varString}) ON CONFLICT (${idName}) DO UPDATE SET ${updateStr} RETURNING *`, varValues);
        return result[0];
    }

    public async commitTransaction(): Promise<any> {
        return this.query("COMMIT");
    }

    public async rollbackTransaction(): Promise<any> {
        return this.query("ROLLBACK");
    }

    public release(): void {
        if (!this.client) throw new Error("This is not a transaction");
        this.client.release();
    }

    public async startTransaction(): Promise<IPostgresTransaction> {
        const pgClient = await this.getClient();
        try {
            const txn = new PostgresDatabase(pgClient.client);
            await txn.query("BEGIN");
            return txn;
        } catch (e) {
            pgClient.client.release();
            throw e;
        }
    }
}