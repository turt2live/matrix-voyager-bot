var Room = require("matrix-js-sdk").Room;
var User = require("matrix-js-sdk").User;
var MatrixEvent = require("matrix-js-sdk").MatrixEvent;

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
        this._store.setItem("sync_token", token);
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

        var serialUser = {
            userId: user.userId,
            presence: user.events.presence ? user.events.presence.event : null
        };
        this._store.setItem("user_" + user.userId, JSON.stringify(serialUser));
    }

    getUser(userId) {
        if (this._users[userId])
            return this._users[userId];

        var data = this._store.getItem("user_" + userId);
        if (!data) return null;

        var obj = JSON.parse(data);
        var presenceEvent = obj.presence ? new MatrixEvent(obj.presence) : null;

        var user = new User(userId);
        if (presenceEvent)
            user.setPresenceEvent(presenceEvent);

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

    _loadRoom(roomId) {
        var data = this._store.getItem("room_" + roomId);
        if (!data) return null;

        var obj = JSON.parse(data);

        var stateEvents = [];
        for (var eventType in obj.state.events) {
            var event = obj.state.events[eventType];
            for (var skey in event) {
                stateEvents.push(new MatrixEvent(event[skey]));
            }
        }

        var room = new Room(roomId);
        room.oldState.setStateEvents(stateEvents);
        room.currentState.setStateEvents(stateEvents);

        return room;
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
}

module.exports = VoyagerMatrixStore;