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
    return Promise.all([
        db.addColumn('node_meta', 'userCount', {type: 'int', notNull: false}),
        db.addColumn('node_meta', 'serverCount', {type: 'int', notNull: false}),
        db.addColumn('node_meta', 'aliasCount', {type: 'int', notNull: false})
    ]);
};

exports.down = function (db) {
    return Promise.all([
        db.removeColumn('node_meta', 'userCount'),
        db.removeColumn('node_meta', 'serverCount'),
        db.removeColumn('node_meta', 'aliasCount')
    ]);
};

exports._meta = {
    "version": 1
};
