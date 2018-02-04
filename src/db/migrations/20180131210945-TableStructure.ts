import { QueryInterface } from "sequelize";
import { DataType } from "sequelize-typescript";
import * as Promise from "bluebird";

export default {
    up: (queryInterface: QueryInterface) => {
        return Promise.resolve()
            .then(() => queryInterface.createTable("voyager_nodes", {
                "id": {type: DataType.INTEGER, primaryKey: true, allowNull: false, autoIncrement: true},
                "type": {type: DataType.STRING, allowNull: false},
                "objectId": {type: DataType.STRING, allowNull: false},
                "isReal": {type: DataType.BOOLEAN, allowNull: false},
                "isRedacted": {type: DataType.BOOLEAN, allowNull: false},
                "isPublic": {type: DataType.BOOLEAN, allowNull: false},
                "displayName": {type: DataType.STRING, allowNull: true},
                "avatarUrl": {type: DataType.STRING, allowNull: true},
                "firstTimestamp": {type: DataType.BIGINT, allowNull: false},
            }))
            .then(() => queryInterface.createTable("voyager_rooms", {
                "roomId": {type: DataType.STRING, primaryKey: true, allowNull: false},
                "userCount": {type: DataType.INTEGER, allowNull: false},
                "serverCount": {type: DataType.INTEGER, allowNull: false},
                "aliasCount": {type: DataType.INTEGER, allowNull: false},
                "primaryAlias": {type: DataType.STRING, allowNull: true},
            }))
            .then(() => queryInterface.createTable("voyager_events", {
                "id": {type: DataType.INTEGER, primaryKey: true, allowNull: false, autoIncrement: true},
                "type": {type: DataType.STRING, allowNull: false},
                "timestamp": {type: DataType.BIGINT, allowNull: false},
                "metaId": {type: DataType.INTEGER, allowNull: false},
                "meta": {type: DataType.STRING, allowNull: false}, // json
            }))
            .then(() => queryInterface.createTable("voyager_links", {
                "id": {type: DataType.INTEGER, primaryKey: true, allowNull: false, autoIncrement: true},
                "type": {type: DataType.STRING, allowNull: false},
                "sourceNodeId": {
                    type: DataType.INTEGER,
                    allowNull: false,
                    references: {model: "voyager_nodes", key: "id"},
                    onUpdate: "cascade", onDelete: "cascade",
                },
                "targetNodeId": {
                    type: DataType.INTEGER,
                    allowNull: false,
                    references: {model: "voyager_nodes", key: "id"},
                    onUpdate: "cascade", onDelete: "cascade",
                },
                "timestamp": {type: DataType.BIGINT, allowNull: false},
                "isVisible": {type: DataType.BOOLEAN, allowNull: false},
                "isRedacted": {type: DataType.BOOLEAN, allowNull: false},
                "eventId": {type: DataType.STRING, allowNull: true},
            }));
    },
    down: (queryInterface: QueryInterface) => {
        return Promise.resolve()
            .then(() => queryInterface.dropTable("voyager_links"))
            .then(() => queryInterface.dropTable("voyager_rooms"))
            .then(() => queryInterface.dropTable("voyager_events"))
            .then(() => queryInterface.dropTable("voyager_nodes"));
    }
}