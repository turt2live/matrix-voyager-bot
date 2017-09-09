module.exports = function (sequelize, DataTypes) {
    return sequelize.define('dnt', {
        userId: {
            type: DataTypes.STRING,
            allowNull: false,
            primaryKey: true,
            field: 'userId'
        },
        isDnt: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            field: 'isDnt'
        }
    }, {
        tableName: 'dnt',
        underscored: false,
        timestamps: false
    });
};
