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
import User from "../models/user";

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
            User,
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

    public isUserTrackable(userId: string): Promise<boolean> {
        return User.findOne({where: {userId: userId}}).then(user => {
            if (!user) return true; // Have not opted out
            return !user.doNotTrack;
        });
    }
}

export const VoyagerStore = new _VoyagerStore();

export function resolveIfExists<T>(record: T): Promise<T> {
    if (!record) return Promise.reject("Record not found");
    return Promise.resolve(record);
}