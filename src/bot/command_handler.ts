import VoyagerBot from "../matrix/default_client";
import { AddMeCommand } from "./commands/addme";
import { RemoveMeCommand } from "./commands/removeme";
import { LinkMeCommand } from "./commands/linkme";
import { UnlinkMeCommand } from "./commands/unlinkme";
import { SearchCommand } from "./commands/search";
import { LeaveCommand } from "./commands/leave";
import { DntCommand } from "./commands/dnt";
import { TrackMeCommand } from "./commands/trackme";
import { LogService } from "matrix-js-snippets";
import { Voyager } from "./voyager";

class _CommandHandler {

    private handlers = {
        "addme": AddMeCommand,
        "showme": AddMeCommand,
        "removeme": RemoveMeCommand,
        "hideme": RemoveMeCommand,
        "linkme": LinkMeCommand,
        "unlinkme": UnlinkMeCommand,
        "search": SearchCommand,
        "leave": LeaveCommand,
        "dnt": DntCommand,
        "donottrack": DntCommand,
        "untrackme": DntCommand,
        "trackme": TrackMeCommand,
    };

    constructor() {
    }

    public handleCommand(roomId: string, event: any, cmdArguments: string[]) {
        if (cmdArguments.length < 1) {
            this.sendHelp(roomId);
            return;
        }

        const handler = this.handlers[cmdArguments[0].toLowerCase()];
        if (handler) {
            handler(roomId, event, cmdArguments.splice(0, 1)).catch(err => {
                LogService.error("CommandHandler", err);
                return Voyager.sendPilledMessage(roomId, event['sender'], "There was an error processing your command.");
            });
        } else this.sendHelp(roomId);
    }

    private sendHelp(roomId: string) {
        VoyagerBot.sendNotice(roomId, "" +
            "!voyager addme             - Adds your user node, and associated links, to the graph\n" +
            "!voyager removeme          - Takes your user node, and associated links, off of the graph\n" +
            "!voyager linkme [room]     - Links your user account to the specified room (defaults to current room)\n" +
            "!voyager unlinkme [room]   - Removes your self-links from the specified room (defaults to current room)\n" +
            "!voyager search <keywords> - Searches for rooms that have the specified keywords\n" +
            "!voyager leave             - Forces the bot to leave the room, but keep the room on the graph\n" +
            "!voyager dnt               - The bot will read your messages, but not follow any links to rooms in them\n" +
            "!voyager trackme           - The bot will read and follow rooms links in your messages. This is the default.\n" +
            "!voyager help              - This menu\n" +
            "\n" +
            "View the current graph online at https://voyager.t2bot.io"
        );
    }
}

export const CommandHandler = new _CommandHandler();