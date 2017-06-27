var CommandProcessor = require("./matrix/CommandProcessor");
var LocalStorage = require("node-localstorage").LocalStorage;
var config = require("config");
var log = require("./LogService");
var naturalSort = require("node-natural-sort");
var MatrixClientLite = require("./matrix/MatrixClientLite");
var _ = require("lodash");

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

        this._nodeUpdateQueue = [];
        this._processingNodes = false;
        this._queuedObjectIds = [];
        this._queueNodesForUpdate = config.get('bot.processNodeUpdatesOnStartup');
        this._queueUsersOnStartup = config.get('bot.nodeUpdatesOnStartup.users');
        this._queueRoomsOnStartup = config.get('bot.nodeUpdatesOnStartup.rooms');

        this._store = store;
        this._commandProcessor = new CommandProcessor(this, store);

        // TODO: {Client Update} re-enable node checking
        //this._loadPendingNodeUpdates();

        this._client = new MatrixClientLite(config['matrix']['homeserverUrl'], config['matrix']['accessToken'], config['matrix']['userId']);

        this._client.on('room_invite', this._onInvite.bind(this));
        this._client.on('room_message', this._onRoomMessage.bind(this));
        this._client.on('room_leave', this._onRoomLeave.bind(this));
        this._client.on('room_avatar', this._onRoomUpdated.bind(this));
        this._client.on('room_name', this._onRoomUpdated.bind(this));
        this._client.on('user_avatar', this._onUserUpdated.bind(this));
        this._client.on('user_name', this._onUserUpdated.bind(this));
    }

    /**
     * Starts the voyager bot
     */
    start() {
        this._client.start().then(() => {
            // TODO: {Client Update} re-enable node checking
            // this._tryUpdateNodeVersions();
            //
            // this._processNodeVersions();
            // setInterval(() => this._processNodeVersions(), 15000);
            //
            // log.info("VoyagerBot", "Enabling node updates now that the bot is syncing");
            // this._queueNodesForUpdate = true;
        });
    }

    _onRoomUpdated(roomId, event) {
        // TODO: {Client Update} mimic object ID format for all node updates
        this._queueNodeUpdate({node: roomId, type: 'room'});
    }

    _onUserUpdated(roomId, event) {
        // TODO: {Client Update} mimic object ID format for all node updates
        this._queueNodeUpdate({node: event['sender'], type: 'user'});
    }

    _onRoomMessage(roomId, event) {
        var body = event['content']['body'];
        if (!body) return; // likely redacted

        if (body.startsWith("!voyager")) {
            this._commandProcessor.processCommand(event, body.substring("!voyager".length).trim().split(" "));
            return;
        }

        var matches = body.match(/[#!][a-zA-Z0-9.\-_#]+:[a-zA-Z0-9.\-_]+[a-zA-Z0-9]/g);
        if(!matches) return;

        var promise = Promise.resolve();
        _.forEach(matches, () => promise = promise.then(() => this._processMatchedLink(roomId, event, match)));

        promise.then(() => this._client.sendReadReceipt(roomId, event['event_id']));
    }

    _onRoomLeave(roomId, event) {
        if(event['membership'] == 'kick'){
            this._onKick(roomId, event);
        } else if(event['membership'] == 'ban') {
            this._onBan(roomId, event);
        } else if(event['membership'] == 'leave') {
            // TODO: Handle self-leave as soft kick (#130)
        }
    }

    _processMatchedLink(inRoomId, event, matchedValue, retryCount = 0) {
        var roomId;
        var sourceNode;
        var targetNode;

        return this._client.joinRoom(matchedValue).then(rid => {
            roomId = rid;
            return this.getNode(inRoomId, 'room');
        }, err => {
            if (err.httpStatus == 500 && retryCount < 5) {
                return this._processMatchedLink(event, matchedValue, ++retryCount);
            }

            log.error("VoyagerBot", err);
            return Promise.resolve(); // TODO: Record failed event as unlinkable node
        }).then(node => {
            if (!room) return Promise.resolve();
            targetNode = node;

            return this.getNode(roomId, 'room');
        }).then(node=> {
            if (!room) return Promise.resolve();
            sourceNode = node;
            return this._store.createLink(sourceNode, targetNode, 'message', event['origin_server_ts']);
        }).then(link=> {
            if (!link) return Promise.resolve();
            return this._store.createTimelineEvent(link, event['origin_server_ts'], event['event_id'], 'Matched: ' + matchedValue);
        });
    }

    _onInvite(roomId, event) {
        var sourceNode;
        var targetNode;

        if (event.__voyagerRepeat) {
            log.info("VoyagerBot", "Attempt #" + event.__voyagerRepeat + " to retry event " + event.getId());
        }

        return this.getNode(event['sender'], 'user').then(node=> {
            sourceNode = node;
            return this.getNode(roomId, 'room');
        }).then(node => {
            targetNode = node;
            return this._store.findLinkByTimeline(sourceNode, targetNode, 'invite', event['event_id']);
        }).then(existingLink => {
            if (existingLink) return Promise.resolve();
            else return this._store.createLink(sourceNode, targetNode, 'invite', event['origin_server_ts'])
                .then(link => this._store.createTimelineEvent(link, event['origin_server_ts'], event['event_id']));
        }).then(() => {
            return this._client.joinRoom(roomId);
        }).then(room => {
            return this._tryUpdateRoomNodeVersion(room);
        }).catch(err => {
            // TODO: {Client Update} Verify that errcode checking still works
            log.error("VoyagerBot", err);
            if (err.errcode == "M_FORBIDDEN" && (!event.__voyagerRepeat || event.__voyagerRepeat < 25)) { // 25 is arbitrary
                event.__voyagerRepeat = (event.__voyagerRepeat ? event.__voyagerRepeat : 0) + 1;
                log.info("VoyagerBot", "Forbidden as part of event " + event['event_id'] + " - will retry for attempt #" + event.__voyagerRepeat + " shortly.");
                setTimeout(() => this._onInvite(roomId, event), 1000); // try again later
            } else if (event.__voyagerRepeat) {
                log.error("VoyagerBot", "Failed to retry event " + event['event_id']);
            }
        });
    }

    _onKick(roomId, event) {
        return this._addKickBan(roomId, event, 'kick');
    }

    _onBan(roomId, event) {
        return this._addKickBan(roomId, event, 'ban');
    }

    _addKickBan(roomId, event, type) {
        var roomNode;
        var userNode;
        var kickbanLink;

        log.info("VoyagerBot", "Recording " + type + " for " + roomId + " made by " + event['sender']);

        return this.getNode(event['sender'], 'user').then(node=> {
            userNode = node;
            return this.getNode(roomId, 'room');
        }).then(node=> {
            roomNode = node;
            return this._store.redactNode(roomNode);
        }).then(() => {
            return this._store.createLink(userNode, roomNode, type, event['origin_server_ts'], false, true);
        }).then(link => {
            kickbanLink = link;
            var reason = (event['content'] || {})['reason'] || null;
            return this._store.createTimelineEvent(kickbanLink, event['origin_server_ts'], event['event_id'], reason);
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
        // TODO: {Client Update} Node creation
        //var user = this._client.getUser(userId);
        var user = null;

        var version = {
            displayName: null,
            avatarUrl: null,
            isAnonymous: !this._store.isEnrolled(userId),
            primaryAlias: null, // users can't have aliases
        };

        if (user) version = this._getUserVersion(user);

        return this._store.createNode('user', userId, version);
    }

    _createRoomNode(roomId) {
        // TODO: {Client Update} Node creation
        //var room = this._client.getRoom(roomId);
        var room = null;

        var version = {
            displayName: null,
            avatarUrl: null,
            isAnonymous: true,
            primaryAlias: null,
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
        // TODO: {Client Update} getUser call
        return this._client.getUser(userId);
    }

    sendNotice(roomId, message) {
        return this._client.sendNotice(roomId, message);
    }

    getRoom(roomId) {
        // TODO: {Client Update} getRoom call
        return this._client.getRoom(roomId);
    }

    leaveRoom(roomId) {
        return this._client.leaveRoom(roomId);
    }

    lookupRoom(roomIdOrAlias) {
        // TODO: {Client Update} getJoinedRooms call
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
