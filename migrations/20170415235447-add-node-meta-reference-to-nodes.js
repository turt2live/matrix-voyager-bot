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
    return db.addColumn('nodes', 'nodeMetaId', {
        type: 'int',
        foreignKey: {
            name: 'fk_node_node_meta',
            table: 'node_meta',
            mapping: 'id',
            rules: {onDelete: 'CASCADE', onUpdate: 'CASCADE'}
        },
        notNull: false
    });
};

exports.down = function (db) {
    return db.removeColumn('nodes', 'nodeMetaId');
};

exports._meta = {
    "version": 1
};
