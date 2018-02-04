import { Model, Sequelize } from "sequelize-typescript";
import config from "../config";
import { LogService } from "matrix-js-snippets";
import Link from "../models/link";
import * as path from "path";
import * as Umzug from "umzug";
import MatrixEvent from "../models/event";
import * as Promise from "bluebird";
import Room from "../models/room";
import GraphNode from "../models/node";

class _VoyagerStore {

    private sequelize: Sequelize;

    constructor() {
        this.sequelize = new Sequelize({
            dialect: 'postgres',
            database: config.database.database,
            username: config.database.username,
            password: config.database.password,
            host: config.database.host,
            port: config.database.port,
            logging: i => LogService.verbose("VoyagerStore [SQL]", i),
        });
        this.sequelize.addModels(<Array<typeof Model>>[
            Link,
            GraphNode,
            Room,
            MatrixEvent,
        ]);
    }

    public updateSchema(): Promise<any> {
        LogService.info("VoyagerStore", "Updating schema...");

        const migrator = new Umzug({
            storage: "sequelize",
            storageOptions: {sequelize: this.sequelize},
            migrations: {
                params: [this.sequelize.getQueryInterface()],
                path: path.join(__dirname, "migrations"),
            }
        });

        return migrator.up();
    }
}

export const VoyagerStore = new _VoyagerStore();

export function resolveIfExists<T>(record: T): Promise<T> {
    if (!record) return Promise.reject("Record not found");
    return Promise.resolve(record);
}