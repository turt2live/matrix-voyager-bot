module.exports = function (sequelize, DataTypes) {
    return sequelize.define('stateEvents', {
        id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            autoIncrement: true,
            primaryKey: true,
            field: 'id'
        },
        type: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'type'
        },
        linkId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            field: 'linkId'
        },
        nodeId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            field: 'nodeId',
            references: {
                model: "nodes",
                key: "id"
            }
        },
        nodeVersionId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            field: 'nodeVersionId',
            references: {
                model: "nodeVersions",
                key: "id"
            }
        },
        timestamp: {
            type: DataTypes.TIME,
            allowNull: false,
            field: 'timestamp'
        }
    }, {
        tableName: 'state_events',
        underscored: false,
        timestamps: false
    });
};
