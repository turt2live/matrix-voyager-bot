var VoyagerMatrixStore = require("./storage/VoyagerMatrixStore");
var CommandProcessor = require("./matrix/CommandProcessor");
var LocalStorage = require("node-localstorage").LocalStorage;
var config = require("config");
var sdk = require("matrix-js-sdk");
var log = require("npmlog");

/**
 * The main entry point for the bot. Handles most of the business logic and bot actions
 */
class VoyagerBot {

    /**
     * Creates a new VoyagerBot
     * @param {VoyagerStore} store the store to use
     */
    constructor(store) {
        var localStorage = new LocalStorage("db/voyager_local_storage", 100 * 1024 * 1024); // quota is 100mb
        var mtxStore = new VoyagerMatrixStore(localStorage);

        this._store = store;
        this._commandProcessor = new CommandProcessor(this, store);

        this._client = sdk.createClient({
            baseUrl: config.get("matrix.homeserverUrl"),
            accessToken: config.get("matrix.accessToken"),
            userId: config.get("matrix.userId"),
            store: mtxStore
        });

        mtxStore.setClient(this._client);

        this._client.on('Room.timeline', this._processTimeline.bind(this));
        this._client.on('RoomMember.membership', this._processMembership.bind(this));
        this._client.on('sync', this._onSync.bind(this));
    }

    _onSync(state, prevState, data) {
        log.info("VoyagerBot", "Sync state: " + prevState + " -> " + state);
        if (state == "ERROR")
            log.error("VoyagerBot", data);
    }

    _processMembership(event, member, oldMembership) {
        if (member.userId != this._client.credentials.userId)
            return Promise.resolve(); // not applicable for us

        var newState = member.membership;
        if (newState == 'invite') {
            return this._onInvite(event);
        } else if (newState == 'leave' && event.getSender() != this._client.credentials.userId) {
            return this._onKick(event);
        } else if (newState == 'ban') {
            return this._onBan(event);
        }

        return Promise.resolve();
    }

    _processTimeline(event, room, toStartOfTimeline, removed, data) {
        if (event.type != 'm.room.message') return Promise.resolve();

        var senderId = event.getSender();
        if (senderId == this._client.credentials.userId) return Promise.resolve();

        var body = event.getContent().body;
        if (!body) return Promise.resolve(); // probably redacted

        if (body.startsWith("!voyager")) {
            return this._commandProcessor.processCommand(event, body.substring("!voyager".length).trim().split(' '))
        }

        var matches = body.match(/[#!][a-zA-Z0-9.\-_#]+:[a-zA-Z0-9.\-_]+[a-zA-Z0-9]/g);
        if (!matches) return Promise.resolve();

        var promises = [];
        for (var match of matches) {
            promises.push(this._processMatchedLink(event, match));
        }

        return Promise.all(promises).then(() => this._client.sendReadReceipt(event));
    }

    _processMatchedLink(event, matchedValue, retryCount = 0) {
        var room;
        var sourceNode;
        var targetNode;

        return this._client.joinRoom(matchedValue).then(r => {
            room = r;
            return this.getNode(room.roomId, 'room');
        }, err => {
            if (err.httpStatus == 500 && retryCount < 5) {
                return this._processRoomLink(event, matchedValue, ++retryCount);
            }

            log.error("VoyagerBot", err);
            return Promise.resolve(); // TODO: Record failed event as unlinkable node
        }).then(node => {
            if (!room) return Promise.resolve();
            targetNode = node;

            return this.getNode(event.getRoomId(), 'room');
        }).then(node=> {
            if (!room)return Promise.resolve();
            sourceNode = node;
            return this._store.createLink(sourceNode, targetNode, 'message');
        }).then(link=> {
            return this._store.createTimelineEvent(link, event.getTs(), event.getId(), 'Matched: ' + matchedValue);
        });
    }

    _onInvite(event) {
        var sourceNode;
        var targetNode;
        var inviteLink;

        return this.getNode(event.getSender(), 'user').then(node=> {
            sourceNode = node;
            return this.getNode(event.getRoomId(), 'room');
        }).then(node => {
            targetNode = node;
            return this._store.createLink(sourceNode, targetNode, 'invite');
        }).then(link=> {
            inviteLink = link;
            return this._store.createTimelineEvent(inviteLink, event.getTs(), event.getId());
        }).then(() => {
            return this._client.joinRoom(event.getRoomId());
        });
    }

    _onKick(event) {
        return this._addKickBan(event, 'kick');
    }

    _onBan(event) {
        return this._addKickBan(event, 'ban');
    }

    _addKickBan(event, type) {
        var roomNode;
        var userNode;
        var kickbanLink;

        return this.getNode(event.getSender(), 'user').then(node=> {
            userNode = node;
            return this.getNode(event.getRoomId(), 'room');
        }).then(node=> {
            roomNode = node;
            return this._store.redactNode(roomNode);
        }).then(() => {
            return this._store.createLink(userNode, roomNode, type, false, true);
        }).then(link => {
            kickbanLink = link;
            return this._store.createTimelineEvent(kickbanLink, event.getTs(), event.getId());
        });
    }

    getNode(objectId, type) {
        return this._store.getNode(type, objectId).then(node => {
            if (node) return Promise.resolve(node);

            if (type == 'user')
                return this._createUserNode(objectId);
            else if (type == 'room')
                return this._createRoomNode(objectId);
            else throw new Error("Unexpected node type: " + type);
        });
    }

    _createUserNode(userId) {
        var user = this._client.getUser(userId);
        if (!user) throw new Error("Could not find user " + userId);

        var version = {
            displayName: user.getDisplayName(),
            avatarUrl: user.avatarUrl ? this._client.mxcUrlToHttp(user.avatarUrl, 128, 128, 'crop', true) : null,
            isAnonymous: this._store.isEnrolled(userId)
        };

        return this._store.createNode('user', userId, version);
    }

    _createRoomNode(roomId) {
        var room = this._client.getRoom(roomId);
        if (!room) throw new Error("Could not find room " + roomId);

        var version = {
            displayName: room.getDisplayName(),
            avatarUrl: room.getAvatarUrl(this._client.getHomeserverUrl(), 128, 128, 'crop'),
            isAnonymous: true
        };

        return this._client.getStateEvent(roomId, 'm.room.join_rules').then(event => {
            if (event) {
                console.log(event);
                version.isAnonymous = event.join_rule == 'public';
            }

            return this._store.createNode('room', roomId, version);
        });
    }

    getUser(userId) {
        return this._client.getUser(userId);
    }

    sendNotice(roomId, message){
        return this._client.sendNotice(roomId, message);
    }

    joinRoom(roomIdOrAlias){
        return this._client.joinRoom(roomIdOrAlias);
    }
}

module.exports = VoyagerBot;