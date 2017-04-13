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

        this._nodeUpdateQueue = [];
        this._processingNodes = false;

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
        this._client.on('RoomState.members', this._processMembership.bind(this));
        this._client.on('sync', this._onSync.bind(this));
        this._client.on('RoomState.events', this._onRoomStateUpdated.bind(this));
        this._client.on('Room', this._onRoom.bind(this));
        this._client.on('User.avatarUrl', this._onUserUpdatedGeneric.bind(this));
        this._client.on('User.displayName', this._onUserUpdatedGeneric.bind(this));
        this._client.on('RoomState.members', this._onRoomMemberUpdated.bind(this));
    }

    /**
     * Starts the voyager bot
     */
    start() {
        this._client.startClient({initialSyncLimit: 5, pollTimeout: 30 * 60 * 1000}); // pollTimeout is 30 minutes
    }

    _onRoomMemberUpdated(event, state, member) {
        return this._tryUpdateUserNodeVersion(member);
    }

    _onUserUpdatedGeneric(event, user) {
        return this._tryUpdateUserNodeVersion(user);
    }

    _onRoom(room) {
        return this._tryUpdateRoomNodeVersion(room);
    }

    _onRoomStateUpdated(event, state) {
        log.info("VoyagerBot", "Updating room state for " + event.getRoomId());
        return this._tryUpdateRoomNodeVersion(this._client.getRoom(event.getRoomId()));
    }

    _onSync(state, prevState, data) {
        log.info("VoyagerBot", "Sync state: " + prevState + " -> " + state);
        if (state == "ERROR")
            log.error("VoyagerBot", data);

        if (state == "PREPARED") {
            this._tryUpdateNodeVersions();

            this._processNodeVersions();
            setInterval(() => this._processNodeVersions(), 15000);
        }
    }

    _processMembership(event, state, member) {
        if (member.userId != this._client.credentials.userId)
            return Promise.resolve(); // not applicable for us

        var newState = member.membership;
        if (newState == 'invite') {
            return this._onInvite(event);
        } else if (newState == 'leave' && event.getSender() != this._client.credentials.userId) {
            return this._onKick(event);
        } else if (newState == 'ban') {
            return this._onBan(event);
        } else if (newState == 'join') {
            return this._tryUpdateRoomNodeVersion(this._client.getRoom(event.getRoomId()));
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
                return this._processMatchedLink(event, matchedValue, ++retryCount);
            }

            log.error("VoyagerBot", err);
            return Promise.resolve(); // TODO: Record failed event as unlinkable node
        }).then(node => {
            if (!room) return Promise.resolve();
            targetNode = node;

            return this.getNode(event.getRoomId(), 'room');
        }).then(node=> {
            if (!room) return Promise.resolve();
            sourceNode = node;
            return this._store.createLink(sourceNode, targetNode, 'message', event.getTs());
        }).then(link=> {
            if (!link) return Promise.resolve();
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
        }).then(room => {
            return this._tryUpdateRoomNodeVersion(room);
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

        log.info("VoyagerBot", "Recording " + type + " for " + event.getRoomId() + " made by " + event.getSender());

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

        var version = {
            displayName: null,
            avatarUrl: null,
            isAnonymous: !this._store.isEnrolled(userId)
        };

        if (user) version = this._getUserVersion(user);

        return this._store.createNode('user', userId, version);
    }

    _createRoomNode(roomId) {
        var room = this._client.getRoom(roomId);

        var version = {
            displayName: null,
            avatarUrl: null,
            isAnonymous: true
        };

        if (room) version = this._getRoomVersion(room);

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
            version.displayName = conversation.user.name; // Don't use disambiguated version
            version.avatarUrl = conversation.user.getAvatarUrl(this._client.getHomeserverUrl(), 128, 128, 'crop', false);
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
            isAnonymous: true,
            primaryAlias: room.getCanonicalAlias()
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

    lookupRoom(roomIdOrAlias) {
        return new Promise((resolve, reject) => {
            var rooms = this._client.getRooms();

            for (var room of rooms) {
                var self = room.getMember(this._client.credentials.userId);
                if (!self || self.membership !== 'join') continue;

                if (room.roomId == roomIdOrAlias
                    || room.getAliases().indexOf(roomIdOrAlias) !== -1
                    || room.getCanonicalAlias() == roomIdOrAlias) {
                    resolve(room);
                    return;
                }
            }

            resolve(null);
        });
    }

    _processNodeVersions() {
        if (this._processingNodes) {
            log.warn("VoyagerBot", "Already processing nodes from queue - skipping interval check");
            return;
        }

        this._processingNodes = true;
        var nodesToProcess = this._nodeUpdateQueue.splice(0, 2500);
        var i = 0;

        log.info("VoyagerBot", "Processing " + nodesToProcess.length + " pending node updates. " + this._nodeUpdateQueue.length + " remaining");

        var processPendingNode = (obj) => {
            switch (obj.type) {
                case "room":
                    return this._tryUpdateRoomNodeVersion(obj.node);
                case "user":
                    return this._tryUpdateUserNodeVersion(obj.node);
                default:
                    log.warn("VoyagerBot", "Could not handle node in update queue: " + JSON.stringify(obj));
                    return Promise.resolve();
            }
        };

        var handler = () => {
            if (i < nodesToProcess.length) {
                processPendingNode(nodesToProcess[i++]).then(handler);
            } else {
                log.info("VoyagerBot", "Processed " + nodesToProcess.length + " node updates. " + this._nodeUpdateQueue.length + " remaining");
                this._processingNodes = false;
            }
        };
        handler();
    }

    _tryUpdateNodeVersions() {
        var rooms = this._client.getRooms();
        for (var room of rooms) {
            this._nodeUpdateQueue.push({node: room, type: 'room'});
        }

        this._store.getNodesByType('user').then(users=> {
            for (var user of users) {
                var mtxUser = this._client.getUser(user.objectId);
                this._nodeUpdateQueue.push({node: mtxUser, type: 'user'});
            }
        });
    }

    _tryUpdateUserNodeVersion(user) {
        if (!user) {
            log.warn("VoyagerBot", "Try update user node failed: User was null");
            return Promise.resolve();
        }
        log.info("VoyagerBot", "Attempting an update for user node: " + user.userId);

        var userNode;
        var userMeta;

        return this.getNode(user.userId, 'user').then(node => {
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
        if (!room) {
            log.warn("VoyagerBot", "Try update room node failed: Room was null");
            return Promise.resolve();
        }
        log.info("VoyagerBot", "Attempting an update for room node: " + room.roomId);

        var roomNode;
        var roomMeta;

        return this.getNode(room.roomId, 'room').then(node => {
            roomNode = node;

            return this._store.getCurrentNodeState(roomNode);
        }).then(meta => {
            roomMeta = meta;
        }).then(() => {
            var realVersion = this._getRoomVersion(room);

            return this._tryUpdateNodeVersion(roomNode, roomMeta, realVersion);
        });
    }

    _replaceNulls(obj, defs) {
        for (var key in obj) {
            if (obj[key] === null || obj[key] === undefined) {
                if (defs[key] !== null && defs[key] !== undefined) {
                    obj[key] = defs[key];
                }
            }
        }
    }

    _tryUpdateNodeVersion(node, meta, currentVersion) {
        var newVersion = {};
        var updated = false;

        var defaults = {displayName: '', avatarUrl: '', isAnonymous: true, primaryAlias: ''};

        // Ensure that `null != ''` doesn't end up triggering an update
        this._replaceNulls(meta, defaults);
        this._replaceNulls(currentVersion, defaults);

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
        if (currentVersion.primaryAlias != meta.primaryAlias && node.type == 'room') {
            newVersion.primaryAlias = currentVersion.primaryAlias || '';
            updated = true;
        }

        if (updated) {
            log.info("VoyagerBot", "Updating meta for node " + node.objectId + " to: " + JSON.stringify(newVersion));

            var oldValues = {};
            for (var key in newVersion) {
                oldValues[key] = meta[key];
            }
            log.info("VoyagerBot", "Old meta for node " + node.objectId + " was (changed properties only): " + JSON.stringify(oldValues));

            return this._store.createNodeVersion(node, newVersion);
        }

        return Promise.resolve();
    }
}

module.exports = VoyagerBot;
