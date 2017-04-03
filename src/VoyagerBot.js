var VoyagerMatrixStore = require("./storage/VoyagerMatrixStore");
var CommandProcessor = require("./matrix/CommandProcessor");
var LocalStorage = require("node-localstorage").LocalStorage;
var config = require("config");
var sdk = require("matrix-js-sdk");
var log = require("npmlog");
var naturalSort = require("node-natural-sort");

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

    /**
     * Starts the voyager bot
     */
    start() {
        this._client.startClient({initialSyncLimit: 5, pollTimeout: 30 * 60 * 1000}); // pollTimeout is 30 minutes
    }

    _onSync(state, prevState, data) {
        log.info("VoyagerBot", "Sync state: " + prevState + " -> " + state);
        if (state == "ERROR")
            log.error("VoyagerBot", data);

        if (state == "PREPARED") {
            this._tryUpdateNodeVersions();
        }
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
        if (event.getType() != 'm.room.message') return Promise.resolve();

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
            return this._store.createLink(sourceNode, targetNode, 'message', event.getTs());
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
            return this._store.createLink(sourceNode, targetNode, 'invite', event.getTs());
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
            return this._store.createLink(userNode, roomNode, type, event.getTs(), false, true);
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

        var version = this._getUserVersion(user);
        return this._store.createNode('user', userId, version);
    }

    _createRoomNode(roomId) {
        var room = this._client.getRoom(roomId);
        if (!room) throw new Error("Could not find room " + roomId);

        var version = this._getRoomVersion(room);
        return this._store.createNode('room', roomId, version);
    }

    _getUserVersion(user) {
        var version = {
            displayName: null,
            avatarUrl: null,
            isAnonymous: !this._store.isEnrolled(user.userId)
        };

        // User display logic is not defined by the spec, and is technically per-room.
        // What we'll do is try and find a 1:1 room between the user and the bot and use
        // the display name and avatar for the user in that room. If they don't have a
        // 1:1 chat open with the bot, then we'll find the most popular room they are in
        // and use the avatar/name from there. If they are in no rooms, we'll default to
        // using null.

        var roomMap = []; // [{ numJoined: number, user: User }]
        var privateConvos = []; // same as roomMap, but for 1:1 chats

        for (var room of this._client.getRooms()) {
            var currentUser = room.getMember(user.userId);
            if (currentUser) {
                var roomInfo = {
                    numJoined: room.getJoinedMembers().length,
                    user: currentUser
                };

                if (roomInfo.count == 2) { // 1 is them, 1 is us
                    privateConvos.push(roomInfo);
                    break; // we found a 1:1, so we'll break early
                }

                roomMap.push(roomInfo);
            }
        }

        var conversation = null;

        if (privateConvos.length > 0) {
            conversation = privateConvos[0];
        } else if (roomMap.length > 0) {
            roomMap.sort((a, b) => {
                return b.numJoined - a.numJoined; // descending
            });

            conversation = roomMap[0];
        }

        if (conversation) {
            version.displayName = conversation.user.rawDisplayName; // Don't use disambiguated version
            version.avatarUrl = this._client.mxcUrlToHttp(conversation.user.avatarUrl, 128, 128, 'crop');
        }

        if (!version.avatarUrl || version.avatarUrl.trim().length == 0)
            version.avatarUrl = null;
        if (!version.displayName || version.displayName.trim().length == 0)
            version.displayName = null;

        return version;
    }

    _getRoomVersion(room) {
        var version = {
            displayName: null,
            avatarUrl: room.getAvatarUrl(this._client.getHomeserverUrl(), 128, 128, 'crop', false), // false = don't allow default icons
            isAnonymous: true
        };

        var joinEvent = room.currentState.getStateEvents('m.room.join_rules', '');
        if (joinEvent) {
            version.isAnonymous = joinEvent.getContent().join_rule !== 'public';
        }

        // Display name logic (according to matrix spec) | http://matrix.org/docs/spec/client_server/r0.2.0.html#id222
        // 1. Use m.room.name
        // 2. Use m.room.canonical_alias
        // 3. Use joined/invited room members (not including self)
        //    a. 1 member - use their display name
        //    b. 2 members - use their display names, lexically sorted
        //    c. 3+ members - use first display name, lexically, and show 'and N others'
        // 4. Consider left users and repeat #3 ("Empty room (was Alice and Bob)")
        // 5. Show 'Empty Room' - this shouldn't happen as it is an error condition in the spec

        // Try to use m.room.name
        var nameEvent = room.currentState.getStateEvents('m.room.name', '');
        if (nameEvent) {
            version.displayName = nameEvent.getContent().name;
        }

        // Try to use m.room.canonical_alias
        if (!version.displayName || version.displayName.trim().length == 0) {
            var aliasEvent = room.currentState.getStateEvents('m.room.canonical_alias', '');
            if (aliasEvent) {
                version.displayName = aliasEvent.getContent().alias;
            }
        }

        // Try to use room members
        if (!version.displayName || version.displayName.trim().length == 0) {
            var members = room.currentState.getMembers();
            var joinedMembers = [];
            var allMembers = [];

            for (var member of members) {
                if (member.userId == this._client.credentials.userId) continue;
                allMembers.push(member);
                if (member.membership == 'invite' || member.membership == 'join')
                    joinedMembers.push(member);
            }

            joinedMembers.sort(naturalSort({caseSensitive: false}));
            allMembers.sort(naturalSort({caseSensitive: false}));

            var memberArr = joinedMembers;
            if (joinedMembers.length == 0) memberArr = allMembers;

            if (memberArr.length == 1)
                version.displayName = memberArr[0].displayName;
            if (memberArr.length == 2)
                version.displayName = memberArr[0].displayName + " and " + memberArr[1].displayName;
            if (memberArr.length > 2)
                version.displayName = memberArr[0].displayName + " and " + (memberArr.length - 1) + " others";

            if (memberArr === allMembers && version.displayName)
                version.displayName = "Empty room (was " + version.displayName + ")";
        }

        // Fallback
        if (!version.displayName || version.displayName.trim().length == 0) {
            version.displayName = "Empty room";
        }

        return version;
    }

    getUser(userId) {
        return this._client.getUser(userId);
    }

    sendNotice(roomId, message) {
        return this._client.sendNotice(roomId, message);
    }

    joinRoom(roomIdOrAlias) {
        return this._client.joinRoom(roomIdOrAlias);
    }

    _tryUpdateNodeVersions() {
        var rooms = this._client.getRooms();
        for (var room of rooms) {
            this._tryUpdateRoomNodeVersion(room);
        }

        this._store.getNodesByType('user').then(users=> {
            for (var user of users) {
                var mtxUser = this._client.getUser(user.objectId);
                this._tryUpdateUserNodeVersion(mtxUser);
            }
        });
    }

    _tryUpdateUserNodeVersion(user) {
        if (!user) return;

        var userNode;
        var userMeta;

        this.getNode(user.userId, 'user').then(node => {
            userNode = node;

            return this._store.getCurrentNodeState(userNode);
        }).then(meta=> {
            userMeta = meta;
        }).then(() => {
            var realVersion = this._getUserVersion(user);

            return this._tryUpdateNodeVersion(userNode, userMeta, realVersion);
        })
    }

    _tryUpdateRoomNodeVersion(room) {
        var roomNode;
        var roomMeta;

        this.getNode(room.roomId, 'room').then(node => {
            roomNode = node;

            return this._store.getCurrentNodeState(roomNode);
        }).then(meta => {
            roomMeta = meta;
        }).then(() => {
            var realVersion = this._getRoomVersion(room);

            return this._tryUpdateNodeVersion(roomNode, roomMeta, realVersion);
        });
    }

    _tryUpdateNodeVersion(node, meta, currentVersion) {
        var newVersion = {};
        var updated = false;

        if (currentVersion.displayName != meta.displayName) {
            newVersion.displayName = currentVersion.displayName || '';
            updated = true;
        }
        if (currentVersion.avatarUrl != meta.avatarUrl) {
            newVersion.avatarUrl = currentVersion.avatarUrl || '';
            updated = true;
        }
        if (currentVersion.isAnonymous != meta.isAnonymous) {
            newVersion.isAnonymous = currentVersion.isAnonymous;
            updated = true;
        }

        if (updated) {
            log.info("VoyagerBot", "Updating meta for node " + node.objectId + " to: " + JSON.stringify(newVersion));
            return this._store.createNodeVersion(node, newVersion);
        }

        return Promise.resolve();
    }
}

module.exports = VoyagerBot;