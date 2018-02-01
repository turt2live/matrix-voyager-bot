import { AutoIncrement, BelongsTo, Column, ForeignKey, Model, PrimaryKey, Table } from "sequelize-typescript";
import Node from "./node";

@Table({
    tableName: "links",
    underscoredAll: false,
    timestamps: false,
})
export default class Link extends Model<Link> {
    @PrimaryKey
    @AutoIncrement
    @Column
    id: number;

    @Column
    @ForeignKey(() => Node)
    sourceNodeId: number;

    @BelongsTo(() => Node)
    sourceNode: Node;

    @Column
    @ForeignKey(() => Node)
    targetNodeId: number;

    @BelongsTo(() => Node)
    targetNode: Node;

    @Column
    timestamp: Date;

    @Column
    isVisible: boolean;

    @Column
    isRedacted: boolean;
}
