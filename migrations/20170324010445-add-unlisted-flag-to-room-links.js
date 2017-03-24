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
    return db.addColumn('room_links', 'unlisted', {type: 'boolean', defaultValue: 0});
};

exports.down = function (db) {
    return db.removeColumn('room_links', 'unlisted');
};

exports._meta = {
    "version": 1
};
