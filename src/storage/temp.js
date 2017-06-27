

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