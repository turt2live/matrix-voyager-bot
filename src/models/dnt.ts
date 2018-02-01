import { Column, Model, PrimaryKey, Table } from "sequelize-typescript";

@Table({
    tableName: "dnt",
    underscoredAll: false,
    timestamps: false,
})
export default class Dnt extends Model<Dnt> {
    @PrimaryKey
    @Column
    userId: string;

    @Column
    isDnt: boolean;
}
