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
    return db.createTable('links', {
        id: {type: 'int', primaryKey: true, autoIncrement: true, notNull: true},
        type: {type: 'string', notNull: true},
        sourceNodeId: {
            type: 'int',
            foreignKey: {name: 'fk_links_source_node_id_nodes_node_id', table: 'nodes', mapping: 'id'},
            notNull: true
        },
        targetNodeId: {
            type: 'int',
            foreignKey: {name: 'fk_links_target_node_id_nodes_node_id', table: 'nodes', mapping: 'id'},
            notNull: true
        },
        timestamp: {type: 'timestamp', notNull: true},
        isVisible: {type: 'boolean', notNull: true},
        isRedacted: {type: 'boolean', notNull: true}
    });
};

exports.down = function (db) {
    return db.dropTable('links');
};

exports._meta = {
    "version": 1
};
