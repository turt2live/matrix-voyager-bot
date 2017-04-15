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
    return db.createTable('state_events', {
        id: {type: 'int', primaryKey: true, autoIncrement: true, notNull: true},
        type: {type: 'string', notNull: true},
        linkId: {
            type: 'int',
            foreignKey: {name: 'fk_state_events_links', table: 'links', mapping: 'id', rules: {onDelete: 'CASCADE', onUpdate: 'CASCADE'}},
            notNull: false
        },
        nodeId: {
            type: 'int',
            foreignKey: {name: 'fk_state_events_nodes', table: 'nodes', mapping: 'id', rules: {onDelete: 'CASCADE', onUpdate: 'CASCADE'}},
            notNull: false
        },
        nodeVersionId: {
            type: 'int',
            foreignKey: {name: 'fk_state_events_node_versions', table: 'node_versions', mapping: 'id', rules: {onDelete: 'CASCADE', onUpdate: 'CASCADE'}},
            notNull: false
        },
        timestamp: {type: 'timestamp', notNull: true}
    });
};

exports.down = function (db) {
    return db.dropTable('state_events');
};

exports._meta = {
    "version": 1
};
