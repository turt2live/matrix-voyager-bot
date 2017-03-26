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
    return db.createTable('nodes', {
        id: {type: 'int', primaryKey: true, autoIncrement: true, notNull: true},
        type: {type: 'string', notNull: true},
        objectId: {type: 'string', notNull: true},
        isReal: {type: 'boolean', notNull: true},
        isRedacted: {type: 'boolean', notNull: true},
        firstTimestamp: {type: 'timestamp', notNull: true}
    });
};

exports.down = function (db) {
    return db.dropTable('nodes');
};

exports._meta = {
    "version": 1
};
