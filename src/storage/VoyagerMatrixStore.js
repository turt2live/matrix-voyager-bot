var Room = require("matrix-js-sdk").Room;
var User = require("matrix-js-sdk").User;
var MatrixEvent = require("matrix-js-sdk").MatrixEvent;
var Q = require("q");

/**
 * Matrix store for keeping track of rooms and other sync data
 */
class VoyagerMatrixStore { // implements StubStore
    /**
     * Creates a new storage store.
     * @param webStore A web storage implementation, such as localStorage
     */
    constructor(webStore) {
        this._store = webStore;

        this._knownRooms = JSON.parse(this._store.getItem("room_map") || "[]");
        this._knownUsers = JSON.parse(this._store.getItem("user_map") || "[]");
        this._syncToken = this._store.getItem("sync_token");

        // Stored in memory and persisted (loaded on demand)
        this._rooms = {}; // roomId: Room
        this._users = {}; // userId: User

        // Stored in memory, and not persisted
        this._filters = {}; // userId: { filterId: Filter }
        this._accountData = {}; // type: content

        this._client = null;
    }

    setClient(client) {
        this._client = client;
    }

    scrollback(room, limit) {
        return []; // no-op
    }

    storeEvents(room, events, token, toStart) {
        // no-op
    }

    getRoomSummaries() {
        return []; // no-op
    }

    getSyncToken() {
        return this._syncToken;
    }

    setSyncToken(token) {
        this._store.setItem("sync_token", token || '');
        this._syncToken = token;
    }

    storeRoom(room) {
        this._rooms[room.roomId] = room;

        if (this._knownRooms.indexOf(room.roomId) === -1) {
            this._knownRooms.push(room.roomId);
            this._store.setItem("room_map", JSON.stringify(this._knownRooms));
        }

        var serialRoom = this._serializeRoom(room);
        this._store.setItem("room_" + room.roomId, JSON.stringify(serialRoom));
    }

    getRoom(roomId) {
        if (this._rooms[roomId])
            return this._rooms[roomId];

        var room = this._loadRoom(roomId);
        this._rooms[roomId] = room;

        return room;
    }

    getRooms() {
        var roomArray = [];
        for (var roomId of this._knownRooms) {
            roomArray.push(this.getRoom(roomId));
        }
        return roomArray;
    }

    removeRoom(roomId) {
        this._rooms[roomId] = null;

        var idx = this._knownRooms.indexOf(roomId);
        if (idx !== -1) this._knownRooms.splice(idx, 1);

        this._store.setItem("room_map", JSON.stringify(this._knownRooms));
        this._store.removeItem("room_" + roomId);
    }

    storeUser(user) {
        this._users[user.userId] = user;

        if (this._knownUsers.indexOf(user.userId) === -1) {
            this._knownUsers.push(user.userId);
            this._store.setItem("user_map", JSON.stringify(this._knownUsers));
        }

        var serialUser = this._serializeUser(user);
        this._store.setItem("user_" + user.userId, JSON.stringify(serialUser));
    }

    getUser(userId) {
        if (this._users[userId])
            return this._users[userId];

        var user = this._loadUser(userId);
        this._users[userId] = user;

        return user;
    }

    getUsers() {
        var userArray = [];
        for (var userId of this._knownUsers) {
            userArray.push(this.getUser(userId));
        }
        return userArray;
    }

    storeFilter(filter) {
        if (!filter) return;

        if (!this._filters[filter.userId])
            this._filters[filter.userId] = {};

        this._filters[filter.userId][filter.filterId] = filter;
    }

    getFilter(userId, filterId) {
        if (!this._filters[userId] || !this._filters[userId][filterId])
            return null;

        return this._filters[userId][filterId];
    }

    getFilterIdByName(filterName) {
        return this._store.getItem("voyager_filter_" + filterName);
    }

    setFilterIdByName(filterName, filterId) {
        this._store.setItem("voyager_filter_" + filterName, filterId);
    }

    storeAccountDataEvents(events) {
        for (var event of events) {
            this._accountData[event.getType()] = event;
        }
    }

    getAccountData(eventType) {
        return this._accountData[eventType];
    }

    setSyncData(data) {
        return Q.Promise((resolve, reject) => {
            this._store.setItem("syncdata", JSON.stringify(data));
            resolve();
        });
    }

    getSavedSync() {
        return Q.Promise((resolve, reject) => {
            var result = this._store.getItem("syncdata");
            if (!result) resolve(null);
            else resolve(JSON.parse(result));
        });
    }

    deleteAllData() {
        return Q.Promise((resolve, reject) => {
            this._store.clear();
            resolve();
        });
    }

    save() {
        // saved on the fly
        return Q.resolve();
    }

    startup() {
        // nothing to do
        return Q.resolve();
    }

    _loadRoom(roomId) {
        var data = this._store.getItem("room_" + roomId);
        if (!data) return null;

        var obj1 = JSON.parse(data);
        var obj2 = JSON.parse(data);

        var stateEvents = [];
        var oldStateEvents = [];
        for (var eventType in obj1.state.events) {
            var event = obj1.state.events[eventType];
            for (var skey in event) {
                stateEvents.push(new MatrixEvent(obj1.state.events[eventType][skey]));
                oldStateEvents.push(new MatrixEvent(obj2.state.events[eventType][skey]));
            }
        }

        var room = new Room(roomId, {
            storageToken: "voyager"
        });
        room.oldState.setStateEvents(oldStateEvents);
        room.currentState.setStateEvents(stateEvents);

        this._registerRoomListeners(room);

        return room;
    }

    _loadUser(userId) {
        var data = this._store.getItem("user_" + userId);
        if (!data) return null;

        var obj = JSON.parse(data);
        var presenceEvent = obj.presence ? new MatrixEvent(obj.presence) : null;
        var displayName = obj.displayName;
        var avatarUrl = obj.avatarUrl;

        var user = new User(userId);
        if (presenceEvent)
            user.setPresenceEvent(presenceEvent);
        if (displayName)
            user.setDisplayName(displayName);
        if (avatarUrl)
            user.setAvatarUrl(avatarUrl);

        this._registerUserListeners(user);

        return user;
    }

    _serializeUser(user) {
        // We store a very limited version of the user to the data store for retrieval later

        var serialized = {
            userId: user.userId,
            presence: user.events.presence ? user.events.presence.event : null,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl
        };

        return serialized;
    }

    _serializeRoom(room) {
        // We store a very limited version of the room to the data store for retrieval later

        var serialized = {
            roomId: room.roomId,
            state: {
                events: {}
            }
        };

        for (var eventType in room.currentState.events) {
            var event = room.currentState.events[eventType];
            for (var skey in event) {
                if (!serialized.state.events[eventType])
                    serialized.state.events[eventType] = {};
                serialized.state.events[eventType][skey] = room.currentState.events[eventType][skey].event;
            }
        }

        return serialized;
    }

    // HACK: This really shouldn't be here. This implies the storage layer is coupled to the application, however that is not supposed
    // to be the case. It is supposed to be independent of the application and just store things.
    _registerRoomListeners(room) {
        if (!this._client) return;

        this._reEmit(this._client, room, ["Room.name", "Room.timeline", "Room.redaction", "Room.receipt", "Room.tags", "Room.timelineReset", "Room.localEchoUpdated", "Room.accountData"]);
        this._reEmit(this._client, room.currentState, ["RoomState.events", "RoomState.members", "RoomState.newMember"]);

        room.currentState.on("RoomState.members", (event, state, member) => {
            if (member.__hasListener) return;
            member.user = this._client.getUser(member.userId);
            member.__hasListener = true;
            this._reEmit(this._client, member, ["RoomMember.name", "RoomMember.typing", "RoomMember.powerLevel", "RoomMember.membership"]);
        });

        // Logic borrowed from matrix-js-sdk
        room.currentState.on("RoomState.newMember", (event, state, member) => {
            if (member.__hasListener) return;
            member.user = this._client.getUser(member.userId);
            member.__hasListener = true;
            this._reEmit(this._client, member, ["RoomMember.name", "RoomMember.typing", "RoomMember.powerLevel", "RoomMember.membership"]);
        });
    }

    // HACK: This really shouldn't be here. This implies the storage layer is coupled to the application, however that is not supposed
    // to be the case. It is supposed to be independent of the application and just store things.
    _registerUserListeners(user) {
        if (!this._client) return;

        this._reEmit(this._client, user, ["User.avatarUrl", "User.displayName", "User.presence", "User.currentlyActive", "User.lastPresenceTs"]);
    }

    // Logic borrowed from syncApi in matrix-js-sdk
    _reEmit(reEmitEntity, emittableEntity, eventNames) {
        for (var eventName of eventNames) {
            this._reEmitEvent(reEmitEntity, emittableEntity, eventName);
        }
    }

    _reEmitEvent(reEmitEntity, emittableEntity, eventName) {
        // setup a listener on the entity (the Room, User, etc) for this event
        emittableEntity.on(eventName, function () {
            // take the args from the listener and reuse them, adding the
            // event name to the arg list so it works with .emit()
            // Transformation Example:
            // listener on "foo" => function(a,b) { ... }
            // Re-emit on "thing" => thing.emit("foo", a, b)
            var newArgs = [eventName];
            for (var i = 0; i < arguments.length; i++) {
                newArgs.push(arguments[i]);
            }
            reEmitEntity.emit.apply(reEmitEntity, newArgs);
        });
    }
}

module.exports = VoyagerMatrixStore;