module.exports = function (sequelize, DataTypes) {
    return sequelize.define('nodes', {
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
        objectId: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'objectId'
        },
        isReal: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            field: 'isReal'
        },
        isRedacted: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            field: 'isRedacted'
        },
        firstTimestamp: {
            type: DataTypes.TIME,
            allowNull: false,
            field: 'firstTimestamp'
        }
    }, {
        tableName: 'nodes',
        underscored: false,
        timestamps: false
    });
};
