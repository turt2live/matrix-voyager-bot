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
    return db.createTable('node_meta', {
        id: {type: 'int', primaryKey: true, autoIncrement: true, notNull: true},
        displayName: {type: 'string', notNull: false},
        avatarUrl: {type: 'string', notNull: false},
        isAnonymous: {type: 'boolean', notNull: false}
    });
};

exports.down = function (db) {
    return db.dropTable('node_meta');
};

exports._meta = {
    "version": 1
};
