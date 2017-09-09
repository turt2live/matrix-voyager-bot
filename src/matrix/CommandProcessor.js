var log = require("./../LogService");
var Promise = require('bluebird');

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
     * @param {string} roomId the room the event happened in
     * @param {*} event the event
     * @param {string[]} cmdArguments the arguments to the command
     * @returns {Promise<*>} resolves when processing complete
     */
    processCommand(roomId, event, cmdArguments) {
        if (cmdArguments.length == 0) {
            return this._reply(roomId, event, 'Unknown command. Try !voyager help');
        }

        if (cmdArguments[0] == 'help') {
            return this._sendHelp(roomId, event);
        } else if (cmdArguments[0] == 'enroll' || cmdArguments[0] == 'showme') {
            return this._store.setEnrolled(event['sender'], true).then(() => this._reply(roomId, event, "Your name and avatar will appear on the graph."));
        } else if (cmdArguments[0] == 'withdraw' || cmdArguments[0] == 'hideme') {
            return this._store.setEnrolled(event['sender'], false).then(() => this._reply(roomId, event, "Your name and avatar will no longer appear on the graph."));
        } else if (cmdArguments[0] == 'linkme') {
            return this._handleSelfLink(roomId, event, /*isLinking=*/true, cmdArguments[1]);
        } else if (cmdArguments[0] == 'unlinkme') {
            return this._handleSelfLink(roomId, event, /*isLinking=*/false, cmdArguments[1]);
        } else if (cmdArguments[0] == 'search') {
            return this._handleSearch(roomId, event, cmdArguments.splice(1));
        } else if (cmdArguments[0] == 'leave') {
            return this._handleSoftKick(roomId, event);
        } else if (cmdArguments[0] == 'addme') {
            return this._handleSelfRedact(roomId, event, /*isAdding=*/true);
        } else if (cmdArguments[0] == 'removeme') {
            return this._handleSelfRedact(roomId, event, /*isAdding=*/false);
        } else if (cmdArguments[0] == 'dnt' || cmdArguments[0] == 'donottrack' || cmdArguments[0] == 'untrackme') {
            return this._handleDnt(roomId, event, /*isTracking=*/false);
        } else if (cmdArguments[0] == 'trackme') {
            return this._handleDnt(roomId, event, /*isTracking=*/true);
        } else return this._reply(roomId, event, "Unknown command. Try !voyager help");
    }

    _reply(roomId, event, message) {
        return this._bot.sendNotice(roomId, event['sender'] + ": " + message);
    }

    _sendHelp(roomId, event) {
        return this._bot.sendNotice(roomId,
            "!voyager showme            - Sets your name and avatar to be visible on the graph\n" +
            "!voyager hideme            - Hides your name and avatar from the graph\n" +
            "!voyager linkme [room]     - Links your user account to the specified room (defaults to current room)\n" +
            "!voyager unlinkme [room]   - Removes your self-links from the specified room (defaults to current room)\n" +
            "!voyager search <keywords> - Searches for rooms that have the specified keywords\n" +
            "!voyager leave             - Forces the bot to leave the room, but keep the room on the graph\n" +
            "!voyager removeme          - Takes your user node, and associated links, off of the graph\n" +
            "!voyager addme             - Adds your user node, and associated links, to the graph\n" +
            "!voyager dnt               - The bot will read your messages, but not follow any links to rooms in them\n" +
            "!voyager trackme           - The bot will read and follow rooms links in your messages. This is the default.\n" +
            "!voyager help              - This menu\n" +
            "\n" +
            "View the current graph online at https://voyager.t2bot.io"
        );
    }

    _handleDnt(roomId, event, isTracking) {
        return this._store.setDnt(event['sender'], !isTracking).then(() => {
            return this._reply(roomId, event, isTracking ? "I'll follow room links you post" : "I'll stop following links to rooms you post in rooms");
        });
    }

    _handleSoftKick(roomId, event) {
        return this._bot.getRoomStateEvents(roomId, 'm.room.power_levels', /*stateKey:*/'')
            .then(powerLevels => {
                if (!powerLevels)
                    return this._reply(roomId, event, "Error processing command: Could not find m.room.power_levels state event").then(() => Promise.reject("Missing m.room.power_levels in room " + roomId));

                var powerLevel = powerLevels['users'][event['sender']];
                if (!powerLevel && powerLevel !== 0) powerLevel = powerLevels['users_default'];
                if (powerLevel < powerLevels['kick'])
                    return this._reply(roomId, event, "You must be at least power level " + powerLevels['kick'] + " to kick me from the room").then(() => Promise.reject(event['sender'] + " does not have permission to kick in room " + roomId));
            })
            .then(() => Promise.all([this._bot.getNode(event['sender'], 'user'), this._bot.getNode(roomId, 'room')]))
            .then(userRoomNodes => this._store.createLink(userRoomNodes[0], userRoomNodes[1], 'soft_kick', event['origin_server_ts'], false, false))
            .then(link => this._store.createTimelineEvent(link, event['origin_server_ts'], event['event_id'], 'Soft kicked'))
            .then(() => this._bot.leaveRoom(roomId))
            .catch(err => {
                log.error("CommandProcessor", err);
            });
    }

    _handleSearch(roomId, event, keywords) {
        if (keywords.length == 0)
            return this._reply(roomId, event, "No keywords specified. Try !voyager search <keywords>");

        return this._store.findNodesMatching(keywords).then(results => {
            // We have to score these ourselves now (the database just does a rough contains check to get a smaller dataset)
            for (var result of results) {
                result.rank = 0;
                result.rank += result.mentionCount * 0.1; // 10% of mention count is added to score to bump numbers
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
                return this._reply(roomId, event, "No results for keywords: " + keywords);

            var response = "Found the following rooms:\n";
            for (var result of sample)
                response += (sample.indexOf(result) + 1) + ". " + (result.meta.primaryAlias || result.aliases[0].alias) + (result.meta.displayName ? " | " + result.meta.displayName : "") + "\n"
            return this._reply(roomId, event, response);
        });
    }

    _handleSelfRedact(roomId, event, isAdding) {
        return this._bot.getNode(event['sender'], 'user')
            .then(node => {
                if (isAdding && !node.isRedacted)
                    return this._reply(roomId, event, "You are already available on the graph");

                if (!isAdding && node.isRedacted)
                    return this._reply(roomId, event, "You are already removed from the graph");

                if (isAdding)
                    return this._store.unredactNode(node).then(() => this._reply(roomId, event, "You have been restored to the graph"));
                else return this._store.redactNode(node).then(() => this._reply(roomId, event, "You have been removed from the graph"));
            });
    }

    _handleSelfLink(inRoomId, event, isLinking, roomArg) {
        var alias = inRoomId;
        var roomId;
        var userNode;
        var roomNode;
        var link;

        if (!roomArg) roomArg = inRoomId;

        return this._bot.matchRoomSharedWith(roomArg, event['sender']).then(roomId => {
            if (!roomId)
                return this._reply(inRoomId, event, "You do not appear to be in the room " + roomArg +" or the room does not exist.").then(() => Promise.reject("Sender not in room or room missing: " + roomArg));
            return roomId;
        }).then(id => {
            roomId = id;
            return this._bot.getNode(event['sender'], 'user');
        }).then(n => {
            userNode = n;
            return this._bot.getNode(roomId, 'room');
        }).then(n => {
            roomNode = n;
            return this._store.findLink(userNode, roomNode, 'self_link');
        }).then(sl => {
            link = sl;

            if (link && isLinking) return this._reply(inRoomId, event, "You are already linked to " + alias);
            if (!link && !isLinking) return this._reply(inRoomId, event, "You are not linked to " + alias);

            if (!link && isLinking) {
                return this._store.createLink(userNode, roomNode, 'self_link', event['origin_server_ts'])
                    .then(link => this._store.createTimelineEvent(link, event['origin_server_ts'], event['event_id']))
                    .then(() => this._store.setEnrolled(event['sender'], true))
                    .then(() => this._reply(inRoomId, event, "You have been linked to " + alias + " and are no longer anonymous"));
            }

            if (link && !isLinking) {
                return this._store.redactLink(link)
                    .then(() => this._store.createTimelineEvent(link, event['origin_server_ts'], event['id']))
                    .then(() => this._reply(inRoomId, event, "You are no longer linked to " + alias));
            }

            throw new Error("Invalid state. isLinking = " + isLinking + ", link = " + link);
        }).catch(err => {
            log.error("CommandProcessor", err);
        });
    }
}

module.exports = CommandProcessor;