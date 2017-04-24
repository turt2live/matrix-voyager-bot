'use strict';

var dbm;
var type;
var seed;

/**
 * We receive the dbmigrate dependency from dbmigrate initially.
 * This enables us to not have to rely on NODE_PATH.
 */
exports.setup = function (options, seedLink) {
    dbm = options.dbmigrate;
    type = dbm.dataType;
    seed = seedLink;
};

exports.up = function (db) {
    return db.createTable('node_aliases', {
        id: {type: 'int', primaryKey: true, autoIncrement: true},
        nodeId: {
            type: 'int',
            foreignKey: {
                name: 'fk_node_aliases_nodes',
                table: 'nodes',
                mapping: 'id',
                rules: {onDelete: 'CASCADE', onUpdate: 'CASCADE'}
            },
            notNull: false
        },
        alias: 'string'
    });
};

exports.down = function (db) {
    return db.dropTable('node_aliases');
};

exports._meta = {
    "version": 1
};
