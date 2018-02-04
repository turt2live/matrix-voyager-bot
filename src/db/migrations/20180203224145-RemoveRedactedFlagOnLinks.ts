import { QueryInterface } from "sequelize";
import { DataType } from "sequelize-typescript";

export default {
    up: (queryInterface: QueryInterface) => {
        return queryInterface.removeColumn("voyager_links", "isRedacted");
    },
    down: (queryInterface: QueryInterface) => {
        return queryInterface.addColumn("voyager_links", "isRedacted", {
            type: DataType.BOOLEAN,
            allowNull: false,
            defaultValue: false
        });
    }
}