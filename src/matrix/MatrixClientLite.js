var request = require('request');
var log = require("../LogService");
var filterJson = require("./filter_template.json");
var LocalStorage = require("node-localstorage").LocalStorage;
var Promise = require('bluebird');
var EventEmitter = require('events');
var _ = require('lodash');

/**
 * Represents a lightweight matrix client with minimal functionality. Fires the following events:
 * * "room_leave" (roomId, leaveEvent)
 * * "room_join" (roomId)
 * * "room_invite" (roomId, inviteEvent)
 * * "room_message" (roomId, messageEvent) - only fired for joined rooms
 * * "room_name" (roomId, nameEvent)
 * * "room_avatar" (roomId, avatarEvent)
 * * "room_join_rules" (roomId, joinRulesEvent)
 * * "user_name" (roomId, nameEvent)
 * * "user_avatar" (roomId, avatarEvent)
 */
class MatrixLiteClient extends EventEmitter {

    /**
     * Creates a new matrix client
     * @param {string} homeserverUrl the homeserver base url
     * @param {string} accessToken the matrix access token
     * @param {string} selfId the ID of the user owning the token
     */
    constructor(homeserverUrl, accessToken, selfId) {
        super();
        this.selfId = selfId;
        this._accessToken = accessToken;
        this._homeserverUrl = homeserverUrl;
        this._requestId = 0;
        this._stopSyncPromise = null;

        if (this._homeserverUrl.endsWith('/'))
            this._homeserverUrl = this._homeserverUrl.substr(0, this._homeserverUrl.length - 2);

        // Note: We use localstorage because we don't need the complexity of a database, and this makes resetting state a lot easier.
        this._kvStore = new LocalStorage("db/mtx_client_lite_localstorage", 100 * 1024 * 1024); // quota is 100mb

        log.verbose("MatrixClientLite", "New client created for " + this.selfId + " at homeserver " + this._homeserverUrl);
    }

    /**
     * Starts the matrix client with the designated filter. If no filter is specified, a new one will be created from
     * a local file.
     * @returns {Promise<*>} resolves when the client has started
     */
    start(filter = null) {
        if (!filter || typeof(filter) !== 'object') {
            log.verbose("MatrixClientLite", "No filter given to start method. Assuming defaults");
            filter = filterJson;
        }

        var createFilter = false;

        var existingFilter = this._kvStore.getItem("m.filter");
        if (existingFilter) {
            existingFilter = JSON.parse(existingFilter);
            log.verbose("MatrixClientLite", "Found existing filter. Checking consistency with given filter");
            if (JSON.stringify(existingFilter.filter) == JSON.stringify(filter)) {
                log.verbose("MatrixClientLite", "Filters are the same - not creating a new one");
                this._filterId = existingFilter.id;
            } else {
                createFilter = true;
            }
        } else createFilter = true;

        var filterPromise = Promise.resolve();
        if (createFilter) {
            log.verbose("MatrixClientLite", "Creating new filter");
            filterPromise = this._do("POST", "/_matrix/client/r0/user/" + this.selfId + "/filter", null, filter).then(response => {
                this._filterId = response["filter_id"];
                this._kvStore.removeItem("m.synctoken"); // clear token because we've got a new filter
                this._kvStore.setItem("m.filter", JSON.stringify({
                    id: this._filterId,
                    filter: filter
                }));
            });
        }

        // Start sync after filter is created
        return filterPromise.then(() => {
            log.info("MatrixClientLite", "Starting sync with filter ID " + this._filterId);
            this._startSync();
        });
    }

    /**
     * Stops the client
     * @returns {Promise<*>} resolves when the client has stopped
     */
    stop() {
        log.info("MatrixClientLite", "Stop requested");
        this._stopSyncPromise = new Promise();
        return this._stopSyncPromise;
    }

    _startSync() {
        var syncToken = this._kvStore.getItem("m.synctoken");

        var promiseWhile = Promise.method(() => {
            if (this._stopSyncPromise) {
                log.info("MatrixClientLite", "Client stop requested - stopping");
                this._stopSyncPromise.resolve();
                return;
            }

            return this._doSync(syncToken).then(response => {
                syncToken = response["next_batch"];
                this._kvStore.setItem("m.synctoken", syncToken);
                log.info("MatrixClientLite", "Received sync. Next token: " + syncToken);

                this._processSync(response);
            }, error => null).then(promiseWhile.bind(this)); // errors are already reported, so suppress
        });
        promiseWhile(); // start the loop
    }

    _doSync(syncToken) {
        log.info("MatrixClientLite", "Doing sync with token: " + syncToken);
        var conf = {
            filter: this._filterId,
            //since: syncToken, // can't have this here or synapse complains when it's null
            full_state: false,
            timeout: 10000
        };
        if (syncToken) conf['since'] = syncToken;

        return this._do("GET", "/_matrix/client/r0/sync", conf, null);
    }

    _processSync(data) {
        if (!data['rooms']) return;

        // process leaves
        var leftRooms = data['rooms']['leave'];
        if (!leftRooms) leftRooms = {};
        _.forEach(_.keys(leftRooms), roomId => {
            var roomInfo = leftRooms[roomId];
            if (!roomInfo['timeline'] || !roomInfo['timeline']['events']) return;

            var leaveEvent = null;
            for (var event of roomInfo['timeline']['events']) {
                if (event['type'] !== 'm.room.member') continue;
                if (event['state_key'] !== this.selfId) continue;
                if (leaveEvent && leaveEvent['unsigned']['age'] < event['unsigned']['age']) continue;

                leaveEvent = event;
            }

            if (!leaveEvent) {
                log.warn("MatrixClientLite", "Left room " + roomId + " without a leave event in /sync");
                return;
            }

            this.emit("room_leave", roomId, leaveEvent);
        });

        // process invites
        var inviteRooms = data['rooms']['invite'];
        if (!inviteRooms) inviteRooms = {};
        _.forEach(_.keys(inviteRooms), roomId => {
            var roomInfo = inviteRooms[roomId];
            if (!roomInfo['invite_state'] || !roomInfo['invite_state']['events']) return;

            var inviteEvent = null;
            for (var event of roomInfo['invite_state']['events']) {
                if (event['type'] !== 'm.room.member') continue;
                if (event['state_key'] !== this.selfId) continue;
                if (event['membership'] !== 'invite') continue;
                if (inviteEvent && inviteEvent['unsigned']['age'] < event['unsigned']['age']) continue;

                inviteEvent = event;
            }

            if (!inviteEvent) {
                log.warn("MatrixClientLite", "Invited to room " + roomId + " without an invite event in /sync");
                return;
            }

            this.emit("room_invite", roomId, inviteEvent);
        });

        // process joined rooms and their messages
        var joinedRooms = data['rooms']['join'];
        if (!joinedRooms) joinedRooms = {};
        var roomIds = _.keys(joinedRooms);
        for (var roomId of roomIds) {
            this.emit("room_join", roomId);

            var roomInfo = joinedRooms[roomId];
            if (!roomInfo['timeline'] || !roomInfo['timeline']['events']) continue;

            for (var event of roomInfo['timeline']['events']) {
                if (event['type'] === 'm.room.message') this.emit("room_message", roomId, event);
                else if (event['type'] === 'm.room.member') this._checkMembershipUpdate(roomId, event);
                else if (event['type'] === 'm.room.name') this.emit("room_name", roomId, event);
                else if (event['type'] === 'm.room.avatar') this.emit("room_avatar", roomId, event);
                else if (event['type'] === 'm.room.join_rules') this.emit("room_join_rules", roomId, event);
                else if (event['type'] === 'm.room.canonical_alias') this.emit("room_join_rules", roomId, event);
                else if (event['type'] === 'm.room.aliases') this.emit("room_join_rules", roomId, event);
                else log.silly("MatrixClientLite", "Not handling sync event " + event['type']);
            }
        }
    }

    _checkMembershipUpdate(roomId, event) {
        var current = event['content'];
        var prev = event['unsigned']['prev_content'];
        if (!prev) return;

        if (prev['avatar_url'] !== current['avatar_url']) this.emit("user_avatar", roomId, event);
        if (prev['displayname'] !== current['displayname']) this.emit("user_name", roomId, event);

        // else no change
    }

    /**
     * Gets the room state for the given room. Returned as raw events.
     * @param {string} roomId the room ID to get state for
     * @returns {Promise<*[]>} resolves to the room's state
     */
    getRoomState(roomId) {
        return this._do("GET", "/_matrix/client/r0/rooms/" + roomId + "/state");
    }

    /**
     * Gets the state events for a given room of a given type under the given state key.
     * @param {string} roomId the room ID
     * @param {string} type the event type
     * @param {String} stateKey the state key, falsey if not needed
     * @returns {Promise<*|*[]>} resolves to the state event(s)
     */
    getRoomStateEvents(roomId, type, stateKey) {
        return this._do("GET", "/_matrix/client/r0/rooms/" + roomId + "/state/" + type + "/" + (stateKey ? stateKey : ''));
    }

    /**
     * Gets information on a given user
     * @param {string} userId the user ID to lookup
     * @returns {Promise<*>} information on the user
     */
    getUserInfo(userId) {
        return this._do("GET", "/_matrix/client/r0/profile/" + userId);
    }

    /**
     * Joins the given room
     * @param {string} roomIdOrAlias the room ID or alias to join
     * @returns {Promise<string>} resolves to the joined room ID
     */
    joinRoom(roomIdOrAlias) {
        roomIdOrAlias = encodeURIComponent(roomIdOrAlias);
        return this._do("POST", "/_matrix/client/r0/join/" + roomIdOrAlias).then(response => {
            return response['room_id'];
        });
    }

    /**
     * Gets a list of joined room IDs
     * @returns {Promise<string[]>} resolves to a list of room IDs the client participates in
     */
    getJoinedRooms() {
        return this._do("GET", "/_matrix/client/r0/joined_rooms").then(response => response['joined_rooms']);
    }

    /**
     * Leaves the given room
     * @param {string} roomId the room ID to leave
     * @returns {Promise<*>} resolves when left
     */
    leaveRoom(roomId) {
        return this._do("POST", "/_matrix/client/r0/rooms/" + roomId + "/leave");
    }

    /**
     * Sends a read receipt for an event in a room
     * @param {string} roomId the room ID to send the receipt to
     * @param {string} eventId the event ID to set the receipt at
     * @returns {Promise<*>} resolves when the receipt has been sent
     */
    sendReadReceipt(roomId, eventId) {
        return this._do("POST", "/_matrix/client/r0/rooms/" + roomId + "/receipt/m.read/" + eventId);
    }

    /**
     * Sends a notice to the given room
     * @param {string} roomId the room ID to send the notice to
     * @param {string} text the text to send
     * @returns {Promise<string>} resolves to the event ID that represents the message
     */
    sendNotice(roomId, text) {
        var txnId = (new Date().getTime()) + "LR" + this._requestId;
        return this._do("PUT", "/_matrix/client/r0/rooms/" + roomId + "/send/m.room.message/" + txnId, null, {
            body: text,
            msgtype: "m.notice"
        }).then(response => {
            return response['event_id'];
        });
    }

    /**
     * Converts a media URI to a thumbnail URL
     * @param {string} mxcUri the mxc uri
     * @param {number} width the width in pixels for the thumbnail
     * @param {number} height the height in pixels for the thumbnail
     * @returns {string} the URL to get the thumbnail at
     */
    convertMediaToThumbnail(mxcUri, width, height) {
        var shorthand = mxcUri.substring("mxc://".length).split("?")[0].split("#")[0]; // split off path components

        // shorthand is serverName/mediaId (which matches the URL format)
        return this._homeserverUrl + "/_matrix/media/r0/thumbnail/" + shorthand + "?width=" + width + "&height=" + height;
    }

    _do(method, endpoint, qs = null, body = null, timeout = 60000, raw = false) {
        if (!endpoint.startsWith('/'))
            endpoint = '/' + endpoint;

        var requestId = ++this._requestId;

        var url = this._homeserverUrl + endpoint;

        log.verbose("MatrixLiteClient (REQ-" + requestId + ")", method + " " + url);

        if (!qs) qs = {};
        qs['access_token'] = this._accessToken;

        var cleanAndStringify = (obj) => {
            var clone = JSON.parse(JSON.stringify(obj));
            if (clone['access_token']) clone['access_token'] = '<redacted>';
            return JSON.stringify(clone);
        };

        if (qs) log.verbose("MatrixLiteClient (REQ-" + requestId + ")", "qs = " + cleanAndStringify(qs));
        if (body) log.verbose("MatrixLiteClient (REQ-" + requestId + ")", "body = " + cleanAndStringify(body));

        var params = {
            url: url,
            method: method,
            json: body,
            qs: qs,
            timeout: timeout,
        };

        return new Promise((resolve, reject) => {
            request(params, (err, response, body) => {
                if (err) {
                    log.error("MatrixLiteClient (REQ-" + requestId + ")", err);
                    reject(err);
                } else {
                    if (typeof(body) === 'string') {
                        try {
                            body = JSON.parse(body);
                        } catch (e) {
                        }
                    }

                    log.verbose("MatrixLiteClient (REQ-" + requestId + " RESP-H" + response.statusCode + ")", response.body);
                    if (response.statusCode < 200 || response.statusCode >= 300) {
                        log.error("MatrixLiteClient (REQ-" + requestId + ")", response.body);
                        reject(response);
                    } else resolve(raw ? response : body);
                }
            });
        });
    }
}

module.exports = MatrixLiteClient;