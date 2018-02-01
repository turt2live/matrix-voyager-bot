import { Model, Sequelize } from "sequelize-typescript";
import config from "../config";
import { LogService } from "matrix-js-snippets";
import Dnt from "../models/dnt";
import NodeAlias from "../models/node_alias";
import Link from "../models/link";
import Node from "../models/node";
import NodeMeta from "../models/node_meta";
import NodeVersion from "../models/node_version";
import StateEvent from "../models/state_event";
import TimelineEvent from "../models/timeline_event";
import * as path from "path";
import * as Umzug from "umzug";

class _VoyagerStore {

    private sequelize: Sequelize;

    constructor() {
        this.sequelize = new Sequelize({
            dialect: 'postgres',
            database: config.database.database,
            username: config.database.username,
            password: config.database.password,
            port: config.database.port,
            logging: i => LogService.verbose("VoyagerStore [SQL]", i),
        });
        this.sequelize.addModels(<Array<typeof Model>>[
            Dnt,
            Link,
            Node,
            NodeAlias,
            NodeMeta,
            NodeVersion,
            StateEvent,
            TimelineEvent,
        ]);
    }

    public updateSchema(): void {
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