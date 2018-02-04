import { QueryInterface } from "sequelize";
import { DataType } from "sequelize-typescript";

export default {
    up: (queryInterface: QueryInterface) => {
        return queryInterface.createTable("voyager_users", {
            "userId": {type: DataType.STRING, primaryKey: true, allowNull: false},
            "doNotTrack": {type: DataType.BOOLEAN, allowNull: false},
        })
    },
    down: (queryInterface: QueryInterface) => {
        return queryInterface.dropTable("voyager_users");
    }
}