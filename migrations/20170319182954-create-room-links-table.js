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
    return db.createTable('room_links', {
        id: {type: 'int', primaryKey: true, autoIncrement: true},
        event_id: 'string',
        parsed_value: 'string',
        type: 'string',
        sender: 'string',
        to_room_id: 'string',
        from_room_id: 'string',
        timestamp: 'timestamp',
        message: 'string',
        error: 'string'
    });
};

exports.down = function (db) {
    return db.dropTable('room_links');
};

exports._meta = {
    "version": 1
};
