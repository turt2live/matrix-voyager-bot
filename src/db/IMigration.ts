import { IPostgresTransaction } from "./postgres";
import { CreateRoomSnapshotsTable } from "./migrations/20181224105745-CreateRoomVersionsTable";

/**
 * Represents a database migration
 */
export interface IMigration {
    /**
     * The ID of this migration
     */
    id: string;

    /**
     * Executes the migration
     * @param {IPostgresTransaction} txn The transaction to execute the migration in
     * @returns {Promise<*>} resolves when complete
     */
    up(txn: IPostgresTransaction): Promise<any>;
}

export const KNOWN_MIGRATIONS: IMigration[] = [
    new CreateRoomSnapshotsTable(),
];