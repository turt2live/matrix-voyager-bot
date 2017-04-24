module.exports = function (sequelize, DataTypes) {
    return sequelize.define('nodeAliases', {
        id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            autoIncrement: true,
            primaryKey: true,
            field: 'id'
        },
        nodeId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'nodeId',
            references: {
                model: "nodes",
                key: "id"
            }
        },
        alias: {
            type: DataTypes.STRING,
            allowNull: true,
            field: 'alias'
        }
    }, {
        tableName: 'node_aliases',
        underscored: false,
        timestamps: false
    });
};
