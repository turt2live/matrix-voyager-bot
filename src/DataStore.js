var sqlite3 = require('sqlite3');
var DBMigrate = require("db-migrate");
var log = require("npmlog");

class DataStore {
    constructor() {
        this._db = null;
    }

    prepare() {
        log.info("DataStore", "Running migrations");
        return new Promise((resolve, reject)=> {
            var dbMigrate = DBMigrate.getInstance(true, {
                config: "./config/database.json",
                env: process.env.NODE_ENV || "development"
            });
            dbMigrate.up().then(() => {
                this._db = new sqlite3.Database("./db/" + (process.env.NODE_ENV || "development") + ".db");
                resolve();
            }, err=> {
                log.error("DataStore", err);
                reject(err);
            }).catch(err=> {
                log.error("DataStore", err);
                reject(err);
            });
        });
    }

    getMembershipEvents() {
        return new Promise((resolve, reject)=> {
            this._db.all("SELECT * FROM membership_events", function (error, rows) {
                if (error) reject(error);
                else resolve(rows);
            });
        });
    }

    getRoomEvents() {
        return new Promise((resolve, reject) => {
            this._db.all("SELECT * FROM room_links", function (error, rows) {
                if (error) reject(error);
                else resolve(rows);
            });
        });
    }

    recordState(eventId, type, roomId, sender, timestamp, message, error = null) {
        return new Promise((resolve, reject)=> {
            this._db.get("SELECT * FROM membership_events WHERE event_id = ?", eventId, function (error, row) {
                if (error) reject(error);
                else if (!row) {
                    this._db.run("INSERT INTO membership_events (event_id, type, room_id, sender, timestamp, message, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        eventId, type, roomId, sender, timestamp, message, error,
                        function (generatedId, error) {
                            if (error) reject(error);
                            else resolve();
                        });
                } else resolve();
            }.bind(this));
        });
    }

    recordRoomLink(eventId, parsedValue, type, toRoomId, fromRoomId, sender, timestamp, message, error = null) {
        return new Promise((resolve, reject)=> {
            this._db.get("SELECT * FROM room_links WHERE event_id = ? AND parsed_value = ?", eventId, parsedValue, function (error, row) {
                if (error) reject(error);
                else if (!row) {
                    this._db.run("INSERT INTO room_links (event_id, parsed_value, type, to_room_id, from_room_id, sender, timestamp, message, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        eventId, parsedValue, type, toRoomId, fromRoomId, sender, timestamp, message, error,
                        function (generatedId, error) {
                            if (error) reject(error);
                            else resolve();
                        });

                    // We run this concurrently as it doesn't actually affect operation
                    if (toRoomId)
                        this._db.run("UPDATE room_links SET to_room_id = ? WHERE parsed_value = ? AND to_room_id IS NULL", toRoomId, toRoomId);
                } else resolve();
            }.bind(this));
        });
    }
}

module.exports = DataStore;