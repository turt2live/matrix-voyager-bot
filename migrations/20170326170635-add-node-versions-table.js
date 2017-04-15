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
    return db.createTable('node_versions', {
        id: {type: 'int', primaryKey: true, autoIncrement: true, notNull: true},
        nodeId: {type: 'int', foreignKey: {name: 'fk_node_version_node', table: 'nodes', mapping: 'id', rules: {onDelete: 'CASCADE', onUpdate: 'CASCADE'}}, notNull: true},
        displayName: {type: 'string', notNull: false},
        avatarUrl: {type: 'string', notNull: false},
        isAnonymous: {type: 'boolean', notNull: false}
    });
};

exports.down = function (db) {
    return db.dropTable('node_versions');
};

exports._meta = {
    "version": 1
};
