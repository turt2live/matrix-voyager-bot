module.exports = function (sequelize, DataTypes) {
    return sequelize.define('timelineEvents', {
        id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            autoIncrement: true,
            primaryKey: true,
            field: 'id'
        },
        linkId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'linkId',
            references: {
                model: "links",
                key: "id"
            }
        },
        message: {
            type: DataTypes.STRING,
            allowNull: true,
            field: 'message'
        },
        matrixEventId: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'matrixEventId'
        },
        timestamp: {
            type: DataTypes.TIME,
            allowNull: false,
            field: 'timestamp'
        }
    }, {
        tableName: 'timeline_events',
        underscored: false,
        timestamps: false
    });
};
