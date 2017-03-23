var config = require("config");
var sdk = require("matrix-js-sdk");
var log = require("npmlog");
var http = require("http");
var https = require("https");
var Buffer = require("buffer").Buffer;
var PublicRoomList = require("./PublicRoomList");

class MatrixHandler {

    constructor(db) {
        this._db = db;

        this._mxid = config.get("matrix.userId");
        this._client = sdk.createClient({
            baseUrl: config.get("matrix.homeserverUrl"),
            accessToken: config.get("matrix.accessToken"),
            userId: this._mxid
        });
        this._publicRoomList = new PublicRoomList(this._client);

        log.info("MatrixHandler", "Using matrix user ID: " + this._mxid);

        this._client.on('Room', room => {
            return this._processRoom(room)
                .catch(error => log.error("MatrixHandler", error));
        });

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

    _processRoom(room) {
        this._publicRoomList.addTrackedRoom(room.roomId);

        for (var memberKey in room.currentState.members) {
            var member = room.currentState.members[memberKey];
            var server = member.userId.split(':')[1];
            this._publicRoomList.addTrackedServer(server);
        }

        return Promise.resolve();
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
        if ((event.sender || event.user_id) == this._client.credentials.userId) return Promise.resolve(); // ignore ourselves

        var room = this._client.getRoom(event.room_id);
        if (!room) return Promise.resolve(); // invalid room (can happen if we've just restarted)

        var body = event.content.body;
        if (!body) return Promise.resolve(); // Probably redacted

        if (body.startsWith('!voyager')) {
            this._processCommand(event, body.substring('!voyager'.length).trim().split(' '));
            // don't need a promise from _processCommand - it should respond appropriately for us
            return Promise.resolve();
        }

        var matches = body.match(/[#!][a-zA-Z0-9.\-_#]+:[a-zA-Z0-9.\-_]+/g);
        if (!matches) return Promise.resolve();

        var dbPromises = [];
        for (var match of matches) {
            dbPromises.push(this._processRoomLink(event, match));
        }

        return Promise.all(dbPromises).then(() => this._client.sendReadReceipt(wrapperEvent));
    }

    _processCommand(event, args) {
        var sender = this._client.getUser(event.sender);

        if (args.length == 0) {
            this._client.sendNotice(event.room_id, sender.displayName + ": Unknown command. Try !voyager help");
            return;
        }

        switch (args[0].toLowerCase()) {
            case 'help':
                this._client.sendNotice(event.room_id,
                    "!voyager showme     - Sets your name and avatar to be visible on the graph\n" +
                    "!voyager hideme     - Hides your name and avatar from the graph\n" +
                    "!voyager help       - This menu"
                );
                break;
            case 'enroll':
            case 'showme':
                this._db.setEnrolledState(event.sender, true).then(() => {
                    this._client.sendNotice(event.room_id, sender.displayName + ": Your name and avatar will now appear on the graph.");
                }, err => {
                    log.error("MatrixHandler", "Error setting enrolled state for " + event.sender);
                    log.error("MatrixHandler", err);
                    this._client.sendNotice(event.room_id, sender.displayName + ": There was an error processing your command.");
                });
                break;
            case 'withdraw':
            case 'hideme':
                this._db.setEnrolledState(event.sender, false).then(() => {
                    this._client.sendNotice(event.room_id, sender.displayName + ": Your name and avatar will no longer appear on the graph.");
                }, err => {
                    log.error("MatrixHandler", "Error setting enrolled state for " + event.sender);
                    log.error("MatrixHandler", err);
                    this._client.sendNotice(event.room_id, sender.displayName + ": There was an error processing your command.");
                });
                break;
            default:
                this._client.sendNotice(event.room_id, "Unknown command. Try !voyager help");
                break;
        }
    }

    _processRoomLink(event, idOrAlias) {
        return this._client.joinRoom(idOrAlias).then(room => {
            return this._db.recordRoomLink(event.event_id, idOrAlias, 'message', room.roomId, event.room_id, event.sender, event.origin_server_ts, event.content.body);
        }, err => {
            log.error("MatrixHandler", err);
            return this._db.recordRoomLink(event.event_id, idOrAlias, 'message', null, event.room_id, event.sender, event.origin_server_ts, event.content.body, err);
        }).catch(err => log.error("MatrixHandler", err));
    }

    isPublicRoom(roomId) {
        var room = this._client.getRoom(roomId);
        if (!room)return false;

        var joinRulesEvent = room.currentState.events['m.room.join_rules'];
        if (!joinRulesEvent) return this._publicRoomList.isPublic(roomId);

        return joinRulesEvent[''].event.content.join_rule === 'public' || this._publicRoomList.isPublic(roomId);
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

    getThumbnail(itemId) {
        return new Promise((resolve, reject) => {
            if (itemId[0] == '#' || itemId[0] == '!') {
                var room = this._client.getRoom(itemId);
                if (!room) {
                    var rooms = this._client.getRooms();
                    for (var knownRoom of rooms) {
                        var aliasEvent = knownRoom.currentState.events['m.room.aliases'];
                        if (aliasEvent) {
                            for (var domain in aliasEvent) {
                                var domainEvent = aliasEvent[domain];
                                var aliases = domainEvent.event.content.aliases;
                                if (aliases && aliases.indexOf(itemId) !== -1) {
                                    room = knownRoom;
                                    break;
                                }
                            }
                            if (room)break;
                        }
                    }

                    if (!room)
                        reject();
                }

                var avatarEvent = room.currentState.events['m.room.avatar'];
                if (!avatarEvent) {
                    reject();
                    return;
                }

                var mxcUrl = avatarEvent[''].event.content.url;
                if (mxcUrl) this._downloadMxcContent(mxcUrl).then(resolve, reject);
                else reject();
            } else if (itemId[0] == '@') {
                var user = this._client.getUser(itemId);
                if (!user.avatarUrl)
                    reject();
                else this._downloadMxcContent(user.avatarUrl).then(resolve, reject);
            } else reject();
        });
    }

    _downloadMxcContent(mxcUrl) {
        var url = this._client.mxcUrlToHttp(mxcUrl, 150, 150, 'crop');
        var ht = url.startsWith("https") ? https : http;

        return new Promise((resolve, reject) => {
            var request = ht.get(url, res => {
                var buffer = Buffer.alloc(0);
                if (res.statusCode !== 200) {
                    reject();
                    return;
                }

                res.on('data', d=> {
                    buffer = Buffer.concat([buffer, d]);
                });
                res.on('end', () => {
                    resolve(buffer);
                });
            });
            request.on('error', e => reject(e));
        });
    }
}

module.exports = MatrixHandler;