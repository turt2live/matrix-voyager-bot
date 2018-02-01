import { QueryInterface } from "sequelize";
import { DataType } from "sequelize-typescript";
import * as Promise from "bluebird";

export default {
    up: (queryInterface: QueryInterface) => {
        // TODO: Build a new database structure to better represent the state of affairs
        return Promise.resolve()
            .then(() => queryInterface.createTable("nodes", {
                "id": {type: DataType.INTEGER, primaryKey: true, allowNull: false, autoIncrement: true},
                "type": {type:DataType.STRING, allowNull: false},
                "objectId": {type:DataType.STRING, allowNull:false},
                "isReal": {type:DataType.BOOLEAN, allowNull:false},
                "isRedacted": {type:DataType.BOOLEAN, allowNull:false},
                "firstTimestamp": {type:DataType.TIME, allowNull:false},
            }));
    },
    down: (queryInterface: QueryInterface) => {
        return Promise.resolve()
            .then(() => queryInterface.dropTable("nodes"))
    }
}