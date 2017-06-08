var VoyagerMatrixStore = require("./storage/VoyagerMatrixStore");
var CommandProcessor = require("./matrix/CommandProcessor");
var LocalStorage = require("node-localstorage").LocalStorage;
var config = require("config");
var sdk = require("matrix-js-sdk");
var log = require("./LogService");
var sqlite3 = require("sqlite3");
var indexeddbjs = require("indexeddb-js");
var naturalSort = require("node-natural-sort");
var IndexedDBStore = require("matrix-js-sdk/lib/store/indexeddb");

/**
 * The main entry point for the bot. Handles most of the business logic and bot actions
 */
class VoyagerBot {

    /**
     * Creates a new VoyagerBot
     * @param {VoyagerStore} store the store to use
     */
    constructor(store) {
        this._localStorage = new LocalStorage("db/voyager_local_storage", 100 * 1024 * 1024); // quota is 100mb
        var mtxStore = new VoyagerMatrixStore(this._localStorage);

        mtxStore = new IndexedDBStore({
            localStorage: new LocalStorage("db/voyager_js_sdk_store", 1024 * 1024 * 1024)  // quota is 1gb
        });

        this._nodeUpdateQueue = [];
        this._processingNodes = false;
        this._queuedObjectIds = [];
        this._queueNodesForUpdate = config.get('bot.processNodeUpdatesOnStartup');
        this._queueUsersOnStartup = config.get('bot.nodeUpdatesOnStartup.users');
        this._queueRoomsOnStartup = config.get('bot.nodeUpdatesOnStartup.rooms');

        this._store = store;
        this._commandProcessor = new CommandProcessor(this, store);

        this._client = sdk.createClient({
            baseUrl: config.get("matrix.homeserverUrl"),
            accessToken: config.get("matrix.accessToken"),
            userId: config.get("matrix.userId"),
            store: mtxStore,
            localTimeoutMs: 30 * 60 * 1000 // 30 min
        });

        mtxStore.setClient(this._client);

        this._loadPendingNodeUpdates();

        this._client.on('sync', this._onSync.bind(this));
        this._client.on('Room', this._onRoom.bind(this));
        this._client.on('Room.timeline', this._processTimeline.bind(this));
        this._client.on('RoomState.members', this._processMembership.bind(this));
        //this._client.on('RoomState.members', this._onRoomMemberUpdated.bind(this));
        this._client.on('RoomState.events', this._onRoomStateUpdated.bind(this));
        //this._client.on('User.avatarUrl', this._onUserUpdatedGeneric.bind(this));
        //this._client.on('User.displayName', this._onUserUpdatedGeneric.bind(this));
    }

    /**
     * Starts the voyager bot
     */
    start() {
        // pollTimeout is 30min
        this._client.startClient({initialSyncLimit: 5, pollTimeout: 30 * 60 * 1000});
    }

    _onRoomMemberUpdated(event, state, member) {
        log.verbose("VoyagerBot", "Room member updated event");
        if (!this._queueNodesForUpdate) {
            log.verbose("VoyagerBot", "Not queuing update of user " + member.userId + " because node updates are currently disabled.");
            return Promise.resolve();
        }
        log.info("VoyagerBot", "Queuing update of user " + member.userId);
        this._queueNodeUpdate({node: member, type: 'user'});
        return Promise.resolve();
    }

    _onUserUpdatedGeneric(event, user) {
        log.verbose("VoyagerBot", "Update user event (generic)");
        if (!this._queueNodesForUpdate) {
            log.verbose("VoyagerBot", "Not queuing update of user " + user.userId + " because node updates are currently disabled.");
            return Promise.resolve();
        }
        log.info("VoyagerBot", "Queuing update of user " + user.userId);
        this._queueNodeUpdate({node: user, type: 'user'});
        return Promise.resolve();
    }

    _onRoom(room) {
        log.verbose("VoyagerBot", "Room event");
        if (!this._queueNodesForUpdate) {
            log.verbose("VoyagerBot", "Not queuing update of room " + room.roomId + " because node updates are currently disabled.");
            return Promise.resolve();
        }
        log.info("VoyagerBot", "Queuing update of room " + room.roomId);
        this._queueNodeUpdate({node: room, type: 'room'});
        return Promise.resolve();
    }

    _onRoomStateUpdated(event, state) {
        log.verbose("VoyagerBot", "Room state updated event");
        if (!this._queueNodesForUpdate) {
            log.verbose("VoyagerBot", "Not queuing update of room state for room " + event.getRoomId() + " because node updates are currently disabled.");
            return Promise.resolve();
        }
        log.info("VoyagerBot", "Queuing update of room state for " + event.getRoomId());
        var room = this._client.getRoom(event.getRoomId());
        if (!room) {
            log.error("VoyagerBot", "Could not update state of room " + event.getRoomId() + " - Room does not exist.");
            return Promise.resolve();
        }
        this._client.store.storeRoom(room);
        this._queueNodeUpdate({node: room, type: 'room', store: true});
        return Promise.resolve();
    }

    _onSync(state, prevState, data) {
        log.info("VoyagerBot", "Sync state: " + prevState + " -> " + state);
        if (state == "ERROR")
            log.error("VoyagerBot", data);

        if (state == "PREPARED") {
            this._tryUpdateNodeVersions();

            this._processNodeVersions();
            setInterval(() => this._processNodeVersions(), 15000);
        } else if (state == "SYNCING" && !this._queueNodesForUpdate) {
            log.info("VoyagerBot", "Enabling node updates now that the bot is syncing");
            this._queueNodesForUpdate = true;
        }
    }

    _processMembership(event, state, member) {
        if (member.userId != this._client.credentials.userId || event.getType() !== 'm.room.member')
            return Promise.resolve(); // not applicable for us

        log.verbose("VoyagerBot", "Process membership");

        var newState = member.membership;
        if (newState == 'invite') {
            return this._onInvite(event);
        } else if (newState == 'leave' && event.getSender() != this._client.credentials.userId) {
            return this._onKick(event);
        } else if (newState == 'ban') {
            return this._onBan(event);
        } else if (newState == 'join') {
            this._queueNodeUpdate({node: this._client.getRoom(event.getRoomId()), type: 'room'});
            return Promise.resolve();
        }

        return Promise.resolve();
    }

    _processTimeline(event, room, toStartOfTimeline, removed, data) {
        log.verbose("VoyagerBot", "Timeline event (" + event.getType() + ")");
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

        if (event.__voyagerRepeat) {
            log.info("VoyagerBot", "Attempt #" + event.__voyagerRepeat + " to retry event " + event.getId());
        }

        return this.getNode(event.getSender(), 'user').then(node=> {
            sourceNode = node;
            return this.getNode(event.getRoomId(), 'room');
        }).then(node => {
            targetNode = node;
            return this._store.findLinkByTimeline(sourceNode, targetNode, 'invite', event.getId());
        }).then(existingLink => {
            if (existingLink) return Promise.resolve();
            else return this._store.createLink(sourceNode, targetNode, 'invite', event.getTs())
                .then(link => this._store.createTimelineEvent(link, event.getTs(), event.getId()));
        }).then(() => {
            return this._client.joinRoom(event.getRoomId());
        }).then(room => {
            return this._tryUpdateRoomNodeVersion(room);
        }).catch(err => {
            log.error("VoyagerBot", err);
            if (err.errcode == "M_FORBIDDEN" && (!event.__voyagerRepeat || event.__voyagerRepeat < 25)) { // 25 is arbitrary
                event.__voyagerRepeat = (event.__voyagerRepeat ? event.__voyagerRepeat : 0) + 1;
                log.info("VoyagerBot", "Forbidden as part of event " + event.getId() + " - will retry for attempt #" + event.__voyagerRepeat + " shortly.");
                setTimeout(() => this._onInvite(event), 1000); // try again later
            } else if (event.__voyagerRepeat) {
                log.error("VoyagerBot", "Failed to retry event " + event.getId());
            }
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
            var reason = (event.getContent() || {}).reason || null;
            return this._store.createTimelineEvent(kickbanLink, event.getTs(), event.getId(), reason);
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

        return this._store.createNode('room', roomId, version, version.aliases);
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
            primaryAlias: room.getCanonicalAlias(),
            aliases: []
        };

        var joinEvent = room.currentState.getStateEvents('m.room.join_rules', '');
        if (joinEvent) {
            version.isAnonymous = joinEvent.getContent().join_rule !== 'public';
        }

        var aliasEvents = room.currentState.getStateEvents('m.room.aliases', undefined);
        var matrixOrgAliases = [];
        if (aliasEvents) {
            for (var evt of aliasEvents) {
                for (var alias of evt.getContent().aliases) {
                    version.aliases.push(alias);
                    if (alias.endsWith(":matrix.org"))
                        matrixOrgAliases.push(alias);
                }
            }
        }
        matrixOrgAliases.sort();
        version.aliases.sort();

        // Display name logic (according to matrix spec) | http://matrix.org/docs/spec/client_server/r0.2.0.html#id222
        // 1. Use m.room.name
        // 2. Use m.room.canonical_alias
        //   a. *Against Spec* Use m.room.aliases, picking matrix.org aliases over other aliases, if no canonical alias
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

        // Try to use m.room.aliases (against spec). Prefer matrix.org
        if (!version.displayName || version.displayName.trim().length == 0 && version.aliases.length > 0) {
            if (matrixOrgAliases.length > 0)
                version.displayName = matrixOrgAliases[0];
            else version.displayName = version.aliases[0];
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
                if (!member.displayName) member.displayName = member.name;
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

    getRoom(roomId) {
        return this._client.getRoom(roomId);
    }

    leaveRoom(roomId) {
        return this._client.leave(roomId);
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

    _queueNodeUpdate(nodeMeta) {
        if (!nodeMeta.node) {
            log.warn("VoyagerBot", "Unexpected node: " + JSON.stringify(nodeMeta));
            return;
        }

        var objectId = nodeMeta.node.userId ? nodeMeta.node.userId : nodeMeta.node.roomId;
        if (this._queuedObjectIds.indexOf(objectId) !== -1) {
            log.info("VoyagerBot", "Node update queue attempt for " + objectId + " - skipped because the node is already queued");
            return;
        }

        this._nodeUpdateQueue.push(nodeMeta);
        this._queuedObjectIds.push(objectId);
        this._savePendingNodeUpdates();

        log.info("VoyagerBot", "Queued update for " + objectId);
    }

    _savePendingNodeUpdates() {
        var simpleNodes = [];
        for (var pendingNodeUpdate of this._nodeUpdateQueue) {
            var obj = {type: pendingNodeUpdate.type};

            if (obj.type == 'user')
                obj.objectId = pendingNodeUpdate.node.userId;
            else if (obj.type == 'room')
                obj.objectId = pendingNodeUpdate.node.roomId;
            else throw new Error("Unexpected node type: " + obj.type);

            simpleNodes.push(obj);
        }

        this._localStorage.setItem("voyager_node_update_queue", JSON.stringify(simpleNodes));
    }

    _loadPendingNodeUpdates() {
        var pendingNodeUpdates = this._localStorage.getItem("voyager_node_update_queue");
        if (pendingNodeUpdates) {
            var nodeUpdatesAsArray = JSON.parse(pendingNodeUpdates);
            for (var update of nodeUpdatesAsArray) {
                var nodeUpdate = {type: update.type};

                if (nodeUpdate.type == 'room')
                    nodeUpdate.node = this._client.getRoom(update.objectId);
                else if (nodeUpdate.type == 'user')
                    nodeUpdate.node = this._client.getUser(update.objectId);
                else throw new Error("Unexpected node type: " + nodeUpdate.type);

                if (!nodeUpdate.node) {
                    log.warn("VoyagerBot", "Skipping node update for " + update.type + " " + update.objectId + " because the node cannot be resolved.");
                    continue;
                }

                this._queueNodeUpdate(nodeUpdate);
            }
        }
        log.info("VoyagerBot", "Loaded " + this._nodeUpdateQueue.length + " previously pending node updates");
    }

    _processNodeVersions() {
        if (this._processingNodes) {
            log.warn("VoyagerBot", "Already processing nodes from queue - skipping interval check");
            return;
        }

        this._processingNodes = true;
        var nodesToProcess = this._nodeUpdateQueue.splice(0, 2500);
        this._savePendingNodeUpdates();
        var i = 0;

        log.info("VoyagerBot", "Processing " + nodesToProcess.length + " pending node updates. " + this._nodeUpdateQueue.length + " remaining");

        var processPendingNode = (obj) => {
            var idx = this._queuedObjectIds.indexOf(obj.node.userId ? obj.node.userId : obj.node.roomId);
            if (idx !== -1) this._queuedObjectIds.splice(idx, 1);

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
                return processPendingNode(nodesToProcess[i++]).then(handler);
            } else {
                log.info("VoyagerBot", "Processed " + nodesToProcess.length + " node updates. " + this._nodeUpdateQueue.length + " remaining");
                this._processingNodes = false;
                return Promise.resolve();
            }
        };
        handler().catch(err => log.error("VoyagerBot", err));
    }

    _tryUpdateNodeVersions() {
        if (!this._queueNodesForUpdate) {
            log.verbose("VoyagerBot", "Skipping state updates for all nodes - node updates are disabled");
            return;
        }

        if (this._queueRoomsOnStartup) {
            var rooms = this._client.getRooms();
            for (var room of rooms) {
                this._queueNodeUpdate({node: room, type: 'room'});
            }
        }

        if (this._queueUsersOnStartup) {
            this._store.getNodesByType('user').then(users => {
                for (var user of users) {
                    var mtxUser = this._client.getUser(user.objectId);
                    this._queueNodeUpdate({node: mtxUser, type: 'user'});
                }
            });
        }
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
        var roomAliases;

        return this.getNode(room.roomId, 'room').then(node => {
            roomNode = node;

            return this._store.getCurrentNodeState(roomNode);
        }).then(meta => {
            roomMeta = meta;

            return this._store.getNodeAliases(roomNode);
        }).then(aliases => {
            roomAliases = aliases || [];
        }).then(() => {
            var realVersion = this._getRoomVersion(room);

            return this._tryUpdateNodeVersion(roomNode, roomMeta, realVersion, roomAliases);
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

    _tryUpdateNodeVersion(node, meta, currentVersion, storedAliases) {
        var newVersion = {};
        var updated = false;
        var aliasesUpdated = false;

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

        if (currentVersion.aliases) {
            if (currentVersion.aliases.length != storedAliases.length) {
                aliasesUpdated = true;
            } else {
                for (var newAlias of storedAliases) {
                    if (currentVersion.aliases.indexOf(newAlias.alias) === -1) {
                        aliasesUpdated = true;
                        break;
                    }
                }
            }
        }

        var versionPromise = Promise.resolve();
        var aliasPromise = Promise.resolve();

        if (updated) {
            log.info("VoyagerBot", "Updating meta for node " + node.objectId + " to: " + JSON.stringify(newVersion));

            var oldValues = {};
            for (var key in newVersion) {
                oldValues[key] = meta[key];
            }
            log.info("VoyagerBot", "Old meta for node " + node.objectId + " was (changed properties only): " + JSON.stringify(oldValues));

            versionPromise = this._store.createNodeVersion(node, newVersion);
        }

        if (aliasesUpdated) {
            log.info("VoyagerBot", "Updating aliases for node " + node.objectId + " to " + JSON.stringify(currentVersion.aliases) + " from " + JSON.stringify(storedAliases));
            aliasPromise = this._store.setNodeAliases(node, currentVersion.aliases);
        }

        return Promise.all([versionPromise, aliasPromise]);
    }
}

module.exports = VoyagerBot;
