import { AutoIncrement, Column, ForeignKey, Model, PrimaryKey, Table } from "sequelize-typescript";
import Node from "./node";

@Table({
    tableName: "voyager_links",
    underscoredAll: false,
    timestamps: false,
})
export default class Link extends Model<Link> {
    @PrimaryKey
    @AutoIncrement
    @Column
    id: number;

    /**
     * The type of link this was, such as 'invite', 'message', or 'soft_kick'.
     */
    @Column
    type: string;

    /**
     * The node that generated the link (such as the room that had another room
     * mentioned in it).
     */
    @Column
    @ForeignKey(() => Node)
    sourceNodeId: number;

    /**
     * The node that is being referenced (such as the room that was mentioned)
     */
    @Column
    @ForeignKey(() => Node)
    targetNodeId: number;

    /**
     * When this link occurred
     */
    @Column
    timestamp: number;

    /**
     * Whether or not this link is visible. This is used to track links/events on rooms,
     * but not advertise them on the graph.
     */
    @Column
    isVisible: boolean;

    /**
     * Whether or not the link is redacted. Redacted links are not considered to exist when
     * performing calculations.
     */
    @Column
    isRedacted: boolean;

    /**
     * The matrix event ID this link was generated from. Older links may not have this.
     */
    @Column
    eventId: string;
}
