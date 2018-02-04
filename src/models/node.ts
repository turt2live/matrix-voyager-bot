import { AutoIncrement, Column, Model, PrimaryKey, Table } from "sequelize-typescript";

@Table({
    tableName: "voyager_nodes",
    underscoredAll: false,
    timestamps: false,
})
export default class GraphNode extends Model<GraphNode> {
    @PrimaryKey
    @AutoIncrement
    @Column
    id: number;

    /**
     * The type of this node. Currently one of 'room', 'user'.
     */
    @Column
    type: string;

    /**
     * The matrix identifier for the object (room ID, user ID, etc)
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
     * Whether or not the node is considered "public". For users, this means that they
     * wish to be included on the graph and other resources. For rooms, this means that
     * the room is public enough to be joined by other users (including the bot).
     */
    @Column
    isPublic: boolean;

    /**
     * The current display name for the object.
     */
    @Column
    displayName: string;

    /**
     * The current avatar URL for the object.
     */
    @Column
    avatarUrl: string;

    /**
     * The timestamp this node was first encountered.
     */
    @Column
    firstTimestamp: number;
}
