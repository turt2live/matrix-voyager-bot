var log = require("npmlog");

class PublicRoomList {

    constructor(matrixClient) {
        this._client = matrixClient;
        this._trackedServers = [];
        this._trackedRooms = [];
        this._knownPublicRoomMap = [];

        //setInterval(this._updateRoomCache.bind(this), 15 * 60 * 1000); // update every 15 minutes
    }

    isPublic(roomId) {
        for (var server in this._knownPublicRoomMap) {
            var rooms = this._knownPublicRoomMap[server];
            if (rooms.indexOf(roomId) !== -1) return true;
        }
        return false;
    }

    addTrackedServer(server) {
        if (this._trackedServers.indexOf(server) === -1)
            this._trackedServers.push(server);
    }

    addTrackedRoom(roomId) {
        if (this._trackedRooms.indexOf(roomId) === -1)
            this._trackedRooms.push(roomId);
    }

    _updateRoomCache() {
        for (var server of this._trackedServers) {
            this._knownPublicRoomMap[server] = [];
            this._updateRoomCacheFor(server);
        }
    }

    _updateRoomCacheFor(server, nextBatchKey = null) {
        var opts = {
            server: server
        };

        if (nextBatchKey)
            opts.since = nextBatchKey;

        this._client.publicRooms(opts).then(results => {
            var nextKey = results.next_batch;
            for (var result of results.chunk) {
                if (this._trackedRooms.indexOf(result.room_id) !== -1)
                    this._knownPublicRoomMap[server].push(result.room_id);
            }

            if (nextKey) this._updateRoomCacheFor(server, nextKey); // don't return because we'll eventually exhaust the stack
            else log.info("PublicRoomList", "Finished room list parse for " + server + ". Found " + this._knownPublicRoomMap[server].length + " rooms");
        }, error => {
            log.error("PublicRoomList", "Could not update room list for " + server + " with key " + nextBatchKey);
            log.error("PublicRoomList", error);
        }).catch(error => {
            log.error("PublicRoomList", "Could not update room list for " + server + " with key " + nextBatchKey);
            log.error("PublicRoomList", error);
        });
    }
}

module.exports = PublicRoomList;