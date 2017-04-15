module.exports = function (sequelize, DataTypes) {
    return sequelize.define('links', {
        id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            primaryKey: true,
            autoIncrement: true,
            field: 'id'
        },
        type: {
            type: DataTypes.STRING,
            allowNull: false,
            field: 'type'
        },
        sourceNodeId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'sourceNodeId',
            references: {
                model: "nodes",
                key: "id"
            }
        },
        targetNodeId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            field: 'targetNodeId',
            references: {
                model: "nodes",
                key: "id"
            }
        },
        timestamp: {
            type: DataTypes.TIME,
            allowNull: false,
            field: 'timestamp'
        },
        isVisible: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            field: 'isVisible'
        },
        isRedacted: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            field: 'isRedacted'
        }
    }, {
        tableName: 'links',
        underscored: false,
        timestamps: false
    });
};
