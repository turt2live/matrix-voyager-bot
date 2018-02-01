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

@Table({
    tableName: "timeline_events",
    underscoredAll: false,
    timestamps: false,
})
export default class TimelineEvent extends Model<TimelineEvent> {
    @PrimaryKey
    @AutoIncrement
    @Column
    id: number;

    @Column
    @ForeignKey(() => Link)
    linkId: number;

    @BelongsTo(() => Link)
    link: Link;

    @Column
    timestamp: Date;

    @Column
    matrixEventId: string;

    @AllowNull
    @Column
    message: string;
}
