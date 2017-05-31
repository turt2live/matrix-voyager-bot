var log = require("./../LogService");
require("string_score"); // automagically adds itself as "words".score(...)

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
        } else if (cmdArguments[0] == 'search') {
            return this._handleSearch(event, cmdArguments.splice(1));
        } else if (cmdArguments[0] == 'leave') {
            return this._handleSoftKick(event);
        } else if (cmdArguments[0] == 'addme') {
            return this._handleSelfRedact(event, /*isAdding=*/true);
        } else if (cmdArguments[0] == 'removeme') {
            return this._handleSelfRedact(event, /*isAdding=*/false);
        } else return this._reply(event, "Unknown command. Try !voyager help");
    }

    _reply(event, message) {
        var sender = this._bot.getUser(event.getSender());

        return this._bot.sendNotice(event.getRoomId(), sender.displayName + ": " + message);
    }

    _sendHelp(event) {
        return this._bot.sendNotice(event.getRoomId(),
            "!voyager showme            - Sets your name and avatar to be visible on the graph\n" +
            "!voyager hideme            - Hides your name and avatar from the graph\n" +
            "!voyager linkme [room]     - Links your user account to the specified room (defaults to current room)\n" +
            "!voyager unlinkme [room]   - Removes your self-links from the specified room (defaults to current room)\n" +
            "!voyager search <keywords> - Searches for rooms that have the specified keywords\n" +
            "!voyager leave             - Forces the bot to leave the room, but keep the room on the graph\n" +
            "!voyager removeme          - Takes your user node, and associated links, off of the graph\n" +
            "!voyager addme             - Adds your user node, and associated links, to the graph\n" +
            "!voyager help              - This menu\n" +
            "\n" +
            "View the current graph online at https://voyager.t2bot.io"
        );
    }

    _handleSoftKick(event) {
        var powerLevelEvent = this._bot.getRoom(event.getRoomId()).currentState.getStateEvents('m.room.power_levels', '');
        if (!powerLevelEvent)
            return this._reply(event, "Error processing command: Could not find m.room.power_levels state event");
        if (event.sender.powerLevel < powerLevelEvent.getContent().kick)
            return this._reply(event, "You must be at least power level " + powerLevelEvent.getContent().kick + " to kick me from the room");

        var userNode = null;
        var roomNode = null;

        return this._bot.getNode(event.getSender(), 'user')
            .then(node => {
                userNode = node;
                return this._bot.getNode(event.getRoomId(), 'room');
            }).then(node => {
                roomNode = node;
                return this._store.createLink(userNode, roomNode, 'soft_kick', event.getTs(), false, false);
            }).then(link => {
                return this._store.createTimelineEvent(link, event.getTs(), event.getId(), 'Soft kicked');
            }).then(() => this._bot.leaveRoom(event.getRoomId()));
    }

    _handleSearch(event, keywords) {
        if (keywords.length == 0)
            return this._reply(event, "No keywords specified. Try !voyager search <keywords>");

        return this._store.findNodesMatching(keywords).then(results => {
            // We have to score these ourselves now (the database just does a rough contains check to get a smaller dataset)
            for (var result of results) {
                result.rank = 0;
                for (var keyword of keywords) {
                    if (result.primaryAlias) result.rank += result.meta.primaryAlias.toLowerCase().split(':', 2)[0].score(keyword.toLowerCase());
                    if (result.displayName) result.rank += result.meta.displayName.toLowerCase().score(keyword.toLowerCase());

                    if (result.aliases) {
                        // We only take the highest alias rank for other aliases to avoid the case where
                        // a room may have several available aliases, all of which are there to just bump
                        // the score up a bit.
                        var highestAliasRank = 0;
                        for (var alias of result.aliases) {
                            var rank = alias.alias.toLowerCase().split(':', 2)[0].score(keyword.toLowerCase());
                            if (rank > highestAliasRank)
                                highestAliasRank = rank;
                        }
                        result.rank += highestAliasRank;
                    }
                }
            }

            results.sort((a, b) => {
                return b.rank - a.rank;
            });

            return results;
        }).then(sortedResults => {
            var sample = sortedResults.splice(0, 5);
            if (sample.length == 0)
                return this._reply(event, "No results for keywords: " + keywords);

            var response = "Found the following rooms:\n";
            for (var result of sample)
                response += (sample.indexOf(result) + 1) + ". " + (result.meta.primaryAlias || result.aliases[0].alias) + (result.meta.displayName ? " | " + result.meta.displayName : "") + "\n"
            return this._reply(event, response);
        });
    }

    _handleSelfRedact(event, isAdding) {
        return this._bot.getNode(event.getSender(), 'user')
            .then(node => {
                if (isAdding && !node.isRedacted)
                    return this._reply(event, "You are already available on the graph");

                if (!isAdding && node.isRedacted)
                    return this._reply(event, "You are already removed from the graph");

                if (isAdding)
                    return this._store.unredactNode(node).then(() => this._reply(event, "You have been restored to the graph"));
                else return this._store.redactNode(node).then(() => this._reply(event, "You have been removed from the graph"));
            });
    }

    _handleSelfLink(event, isLinking, roomArg) {
        var alias = event.getRoomId();
        var roomId;
        var userNode;
        var roomNode;
        var link;

        if (!roomArg)
            roomArg = event.getRoomId();

        return this._bot.lookupRoom(roomArg).then(room => {
            if (room) {
                var roomAlias = room.getCanonicalAlias();
                if (!roomAlias) roomAlias = room.getAliases()[0];
                if (roomAlias) alias = roomAlias;

                var sender = room.getMember(event.getSender());
                if (!sender || sender.membership !== 'join') {
                    return this._reply(event, "You do not appear to be in the room " + roomArg).then(() => {
                        throw new Error("Sender not in room: " + roomArg);
                    });
                }

                return Promise.resolve(room.roomId);
            } else {
                return this._reply(event, "Could not find room " + roomArg).then(() => {
                    throw new Error("Unknown room (non-fatal): " + roomArg); // safe error
                });
            }
        }).then(id=> {
            roomId = id;
            return this._bot.getNode(event.getSender(), 'user');
        }).then(n=> {
            userNode = n;
            return this._bot.getNode(roomId, 'room');
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