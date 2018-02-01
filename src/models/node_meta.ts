import { AllowNull, AutoIncrement, Column, Model, PrimaryKey, Table } from "sequelize-typescript";

@Table({
    tableName: "node_meta",
    underscoredAll: false,
    timestamps: false,
})
export default class NodeMeta extends Model<NodeMeta> {
    @PrimaryKey
    @AutoIncrement
    @Column
    id: number;

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

    @AllowNull
    @Column
    userCount: number;

    @AllowNull
    @Column
    aliasCount: number;

    @AllowNull
    @Column
    serverCount: number;
}
