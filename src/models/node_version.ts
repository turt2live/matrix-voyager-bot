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
    tableName: "node_versions",
    underscoredAll: false,
    timestamps: false,
})
export default class NodeVersion extends Model<NodeVersion> {
    @PrimaryKey
    @AutoIncrement
    @Column
    id: number;

    @Column
    @ForeignKey(() => Node)
    nodeId: number;

    @BelongsTo(() => Node)
    node: Node;

    @AllowNull
    @Column
    displayName: string;

    @AllowNull
    @Column
    avatarUrl: string;

    @AllowNull
    @Column
    isAnonymous: boolean;

    @AllowNull
    @Column
    primaryAlias: string;
}
