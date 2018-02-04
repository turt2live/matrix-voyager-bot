import { Column, Model, PrimaryKey, Table } from "sequelize-typescript";

@Table({
    tableName: "voyager_users",
    underscoredAll: false,
    timestamps: false,
})
export default class User extends Model<User> {
    @PrimaryKey
    @Column
    userId: string;

    @Column
    doNotTrack: boolean;
}
