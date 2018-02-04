import { Column, Model, PrimaryKey, Table } from "sequelize-typescript";

@Table({
    tableName: "voyager_rooms",
    underscoredAll: false,
    timestamps: false,
})
export default class Room extends Model<Room> {
    @PrimaryKey
    @Column
    roomId: string;

    @Column
    userCount: number;

    @Column
    serverCount: number;

    @Column
    aliasCount: number;

    @Column
    primaryAlias: string;
}
