'use strict';

var dbm;
var type;
var seed;
var fs = require('fs');
var path = require('path');
var Promise;

var dbConfig = require(process.env.VOYAGER_DB_CONF_MIGRATE || "../config/database.json");
var dbConfigEnv = dbConfig[process.env.NODE_ENV || 'development'];

/**
 * We receive the dbmigrate dependency from dbmigrate initially.
 * This enables us to not have to rely on NODE_PATH.
 */
exports.setup = function (options, seedLink) {
    dbm = options.dbmigrate;
    type = dbm.dataType;
    seed = seedLink;
    Promise = options.Promise;
};

exports.up = function (db) {
    var filePath = path.join(__dirname, 'sqls', dbConfigEnv.driver, '20170415204327-add-vacuum-rules-to-psql-up.sql');
    return new Promise(function (resolve, reject) {
        fs.readFile(filePath, {encoding: 'utf-8'}, function (err, data) {
            if (err) return reject(err);
            console.log('received data: ' + data);

            console.log("!!!! It is recommended to run `VACUUM ANALYZE <table name>` ON ALL TABLES. See migration script for example.");
            resolve(data);
        });
    }).then(function (data) {
        return db.runSql(data);
    });
};

exports.down = function (db) {
    throw new Error("Unsupported");
};

exports._meta = {
    "version": 1
};
