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
    return db.createTable('timeline_events', {
        id: {type: 'int', primaryKey: true, autoIncrement: true, notNull: true},
        linkId: {
            type: 'int',
            foreignKey: {name: 'fk_timeline_events_links', table: 'links', mapping: 'id'},
            notNull: true
        },
        message: {type: 'string', notNull: false},
        matrixEventId: {type: 'string', notNull: true},
        timestamp: {type: 'timestamp', notNull: true}
    });
};

exports.down = function (db) {
    return db.dropTable('timeline_events');
};

exports._meta = {
    "version": 1
};
