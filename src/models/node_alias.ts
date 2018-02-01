import {
    AllowNull,
    AutoIncrement,
    BelongsTo,
    Column,
    ForeignKey,
    Model,
    PrimaryKey,
    Table
} from "sequelize-typescript";
import Node from "./node";

@Table({
    tableName: "node_aliases",
    underscoredAll: false,
    timestamps: false,
})
export default class NodeAlias extends Model<NodeAlias> {
    @PrimaryKey
    @AutoIncrement
    @Column
    id: number;

    @AllowNull
    @Column
    alias: string;

    @Column
    @ForeignKey(() => Node)
    nodeId: number;

    @BelongsTo(() => Node)
    node: Node;
}
