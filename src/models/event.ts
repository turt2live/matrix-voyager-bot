import { AutoIncrement, Column, Model, PrimaryKey, Table } from "sequelize-typescript";

@Table({
    tableName: "voyager_events",
    underscoredAll: false,
    timestamps: false,
})
export default class MatrixEvent extends Model<MatrixEvent> {
    @PrimaryKey
    @AutoIncrement
    @Column
    id: number;

    /**
     * The type of the event
     */
    @Column
    type: string;

    /**
     * The timestamp of the event
     */
    @Column
    timestamp: number;

    /**
     * The ID of object that represents the metadata. Currently either a link ID or node ID.
     */
    @Column
    metaId: number;

    /**
     * The metadata that applies to the event.
     */
    @Column
    meta: string;
}
