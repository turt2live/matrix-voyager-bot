module.exports = function (sequelize, DataTypes) {
    return sequelize.define('nodeMeta', {
        id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            autoIncrement: true,
            primaryKey: true,
            field: 'id'
        },
        displayName: {
            type: DataTypes.STRING,
            allowNull: true,
            field: 'displayName'
        },
        avatarUrl: {
            type: DataTypes.STRING,
            allowNull: true,
            field: 'avatarUrl'
        },
        isAnonymous: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
            field: 'isAnonymous'
        },
        primaryAlias: {
            type: DataTypes.STRING,
            allowNull: true,
            field: 'primaryAlias'
        }
    }, {
        tableName: 'node_meta',
        underscored: false,
        timestamps: false
    });
};
