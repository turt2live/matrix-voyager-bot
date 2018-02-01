import { AutoIncrement, BelongsTo, Column, ForeignKey, Model, PrimaryKey, Table } from "sequelize-typescript";
import NodeMeta from "./node_meta";

@Table({
    tableName: "nodes",
    underscoredAll: false,
    timestamps: false,
})
export default class Node extends Model<Node> {
    @PrimaryKey
    @AutoIncrement
    @Column
    id: number;

    /**
     * The type of this node. Either 'room' or 'user'
     */
    @Column
    type: string;

    /**
     * The matrix identifier for the object (room ID or user ID)
     */
    @Column
    objectId: string;

    /**
     * Whether or not this is a real matrix object, or one that is assumed as existing.
     * The objectId may not be a valid identifier, and may be in the wrong format.
     */
    @Column
    isReal: boolean;

    /**
     * Whether or not the node has been redacted from the graph. Redacted nodes are not
     * considered to exist when performing calculations.
     */
    @Column
    isRedacted: boolean;

    /**
     * The timestamp this node was first encountered.
     */
    @Column
    firstTimestamp: Date;

    @Column
    @ForeignKey(() => NodeMeta)
    nodeMetaId: number;

    // TODO: Move node meta into the node
    /**
     * Additional metadata about the node
     */
    @BelongsTo(() => NodeMeta)
    meta: NodeMeta;
}
