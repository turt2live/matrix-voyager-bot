var config = require("config");
var sdk = require("matrix-js-sdk");
var log = require("npmlog");

class MatrixHandler {

    constructor(db) {
        this._db = db;

        this._mxid = config.get("matrix.userId");
        this._client = sdk.createClient({
            baseUrl: config.get("matrix.homeserverUrl"),
            accessToken: config.get("matrix.accessToken"),
            userId: this._mxid
        });

        log.info("MatrixHandler", "Using matrix user ID: " + this._mxid);

        this._client.on('Room.timeline', event => {
            return this._processTimelineEvent(event) // the actual event is nested for some reason
                .catch(error => log.error("MatrixHandler", error));
        });

        this._client.on('RoomMember.membership', event=> {
            return this._processMembership(event.event) // the actual event is nested for some reason
                .catch(error => log.error("MatrixHandler", error));
        });
    }

    listen() {
        this._client.startClient(25); // only keep 25 events in memory
    }

    _processMembership(event) {
        if (event.state_key != this._mxid) return Promise.resolve(); // not for us

        if (event.membership == 'invite') {
            return this._db.recordState(event.event_id, 'invite', event.room_id, event.sender, event.origin_server_ts, null).then(() => {
                return this._client.joinRoom(event.room_id);
            });
        } else if (event.membership == 'leave' && event.sender != this._mxid) {
            return this._db.recordState(event.event_id, 'kick', event.room_id, event.sender, event.origin_server_ts, event.content.reason || null);
        } else if (event.membership == 'ban') {
            return this._db.recordState(event.event_id, 'ban', event.room_id, event.sender, event.origin_server_ts, event.content.reason || null);
        }// else console.log(event);

        return Promise.resolve();
    }

    _processTimelineEvent(wrapperEvent) {
        var event = wrapperEvent.event;
        if (event.type != 'm.room.message') return Promise.resolve(); // don't care

        var body = event.content.body;
        if (!body) return Promise.resolve(); // Probably redacted

        var matches = body.match(/[#!][a-zA-Z0-9.\-_#]+:[a-zA-Z0-9.\-_]+/g);
        if (!matches) return Promise.resolve();

        var dbPromises = [];
        for (var match of matches) {
            dbPromises.push(this._processRoomLink(event, match));
        }

        return Promise.all(dbPromises).then(() => this._client.sendReadReceipt(wrapperEvent));
    }

    _processRoomLink(event, idOrAlias) {
        return this._client.joinRoom(idOrAlias).then(room => {
            return this._db.recordRoomLink(event.event_id, idOrAlias, 'message', room.roomId, event.room_id, event.sender, event.origin_server_ts, event.content.body);
        }, err => {
            log.error("MatrixHandler", err);
            return this._db.recordRoomLink(event.event_id, idOrAlias, 'message', null, event.room_id, event.sender, event.origin_server_ts, event.content.body, err);
        }).catch(err => log.error("MatrixHandler", err));
    }

    getRoomAlias(roomId) {
        var room = this._client.getRoom(roomId);
        if (!room)return roomId;

        var canonicalAliasEvent = room.currentState.events['m.room.canonical_alias'];
        if (canonicalAliasEvent) {
            var alias = canonicalAliasEvent[''].event.content.alias;
            if (alias) return alias;
        }

        var aliasEvent = room.currentState.events['m.room.aliases'];
        if (!aliasEvent) return roomId;

        for (var domain in aliasEvent) {
            var domainEvent = aliasEvent[domain];
            var aliases = domainEvent.event.content.aliases;
            if (aliases && aliases.length > 0) {
                return aliases[0];
            }
        }

        return roomId;
    }
}

module.exports = MatrixHandler;