var log = require("npmlog");

/**
 * Processes bot commands from Matrix
 */
class CommandProcessor {

    /**
     * Creates a new command processor
     * @param {VoyagerBot} bot the bot instance this processor is for
     * @param {VoyagerStore} store the store to use
     */
    constructor(bot, store) {
        this._bot = bot;
        this._store = store;
    }

    /**
     * Processes a command from Matrix
     * @param {MatrixEvent} event the event
     * @param {string[]} cmdArguments the arguments to the command
     * @returns {Promise<*>} resolves when processing complete
     */
    processCommand(event, cmdArguments) {
        if (cmdArguments.length == 0) {
            return this._reply(event, 'Unknown command. Try !voyager help');
        }

        if (cmdArguments[0] == 'help') {
            return this._sendHelp(event);
        } else if (cmdArguments[0] == 'enroll' || cmdArguments[0] == 'showme') {
            return this._store.setEnrolled(event.getSender(), true).then(() =>this._reply(event, "Your name and avatar will appear on the graph."));
        } else if (cmdArguments[0] == 'withdraw' || cmdArguments[0] == 'hideme') {
            return this._store.setEnrolled(event.getSender(), false).then(() => this._reply(event, "Your name and avatar will no longer appear on the graph."));
        } else if (cmdArguments[0] == 'linkme') {
            return this._handleSelfLink(event, /*isLinking=*/true, cmdArguments[1]);
        } else if (cmdArguments[0] == 'unlinkme') {
            return this._handleSelfLink(event, /*isLinking=*/false, cmdArguments[1]);
        } else return this._reply(event, "Unknown command. Try !voyager help");
    }

    _reply(event, message) {
        var sender = this._bot.getUser(event.getSender());

        return this._bot.sendNotice(event.getRoomId(), sender.displayName + ": " + message);
    }

    _sendHelp(event) {
        return this._bot.sendNotice(event.getRoomId(),
            "!voyager showme     - Sets your name and avatar to be visible on the graph\n" +
            "!voyager hideme     - Hides your name and avatar from the graph\n" +
            "!voyager linkme     - Links your user account to this current room on the graph\n" +
            "!voyager unlinkme   - Removes your self-links from the current room on the graph\n" +
            "!voyager help       - This menu"
        );
    }

    _handleSelfLink(event, isLinking, roomArg) {
        var alias = event.getRoomId();
        var roomId;
        var userNode;
        var roomNode;
        var link;

        return this._bot.joinRoom(roomArg || event.getRoomId()).then(room => {
            if (room) {
                var roomAlias = room.getCanonicalAlias();
                if (!roomAlias) roomAlias = room.getAliases()[0];
                if (roomAlias) alias = roomAlias;
                return Promise.resolve(room.room_id);
            } else {
                return this._reply(event, "Could not find room " + roomArg).then(() => {
                    throw new Error("Unknown room: " + roomArg);
                });
            }
        }).then(id=> {
            roomId = id;
            return this._bot.getNode(event.getSender(), 'user');
        }).then(n=> {
            userNode = n;
            return this._bot.getNode(event.getRoomId(), 'room');
        }).then(n=> {
            roomNode = n;
            return this._store.findLink(userNode, roomNode, 'self_link');
        }).then(sl=> {
            link = sl;

            if (link && isLinking) return this._reply(event, "You are already linked to " + alias);
            if (!link && !isLinking) return this._reply(event, "You are not linked to " + alias);

            if (!link && isLinking) {
                return this._store.createLink(userNode, roomNode, 'self_link', event.getTs())
                    .then(link => this._store.createTimelineEvent(link, event.getTs(), event.getId()))
                    .then(() => this._store.setEnrolled(event.getSender(), true))
                    .then(() => this._reply(event, "You have been linked to " + alias + " and are no longer anonymous"));
            }

            if (link && !isLinking) {
                return this._store.redactLink(link)
                    .then(() => this._store.createTimelineEvent(link, event.getTs(), event.getId()))
                    .then(() => this._reply(event, "You are no longer linked to " + alias));
            }

            throw new Error("Invalid state. isLinking = " + isLinking + ", link = " + link);
        }).catch(err=> {
            log.error("CommandProcessor", err);
        });
    }
}

module.exports = CommandProcessor;