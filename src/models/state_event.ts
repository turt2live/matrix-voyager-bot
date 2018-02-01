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
import Link from "./link";
import Node from "./node";
import NodeVersion from "./node_version";

@Table({
    tableName: "state_events",
    underscoredAll: false,
    timestamps: false,
})
export default class StateEvent extends Model<StateEvent> {
    @PrimaryKey
    @AutoIncrement
    @Column
    id: number;

    @AllowNull
    @Column
    @ForeignKey(() => Link)
    linkId: number;

    @BelongsTo(() => Link)
    link: Link;

    @AllowNull
    @Column
    @ForeignKey(() => Node)
    nodeId: number;

    @BelongsTo(() => Node)
    node: Node;

    @AllowNull
    @Column
    @ForeignKey(() => NodeVersion)
    nodeVersionId: number;

    @BelongsTo(() => NodeVersion)
    nodeVersion: NodeVersion;

    @Column
    timestamp: Date;

    @Column
    type: string;
}
