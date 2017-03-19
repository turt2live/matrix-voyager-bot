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
    return db.createTable('membership_events', {
        id: {type: 'int', primaryKey: true, autoIncrement: true},
        event_id: 'string',
        type: 'string',
        sender: 'string',
        room_id: 'string',
        timestamp: 'timestamp',
        message: 'string',
        error: 'string'
    });
};

exports.down = function (db) {
    return db.dropTable('membership_events');
};

exports._meta = {
    "version": 1
};
