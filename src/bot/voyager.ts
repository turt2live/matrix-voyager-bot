import GraphNode from "../models/node";
import * as Promise from "bluebird";
import joinRoom from "./join_strategy";
import Link from "../models/link";
import { LogService } from "matrix-js-snippets";
import VoyagerBot from "../matrix/default_client";
import { VoyagerStore } from "../db/voyager_store";
import { CommandHandler } from "./command_handler";

class _Voyager {

    constructor() {
    }

    public start() {
        VoyagerBot.on("room.invite", this.onInvite.bind(this));
        VoyagerBot.on("room.join", this.onJoin.bind(this));
        VoyagerBot.on("room.leave", this.onLeave.bind(this));
        VoyagerBot.on("room.message", this.onMessage.bind(this));
    }

    private onInvite(roomId: string, event: any) {
        LogService.info("Voyager", "Received invite to " + roomId);
        joinRoom(roomId).then(() => {
            return Promise.all([this.getNode(event['sender'], 'user'), this.getNode(roomId, 'room')]);
        }).then(nodes => {
            // TODO: Record link_added event
            return Link.create({
                type: "invite",
                sourceNodeId: nodes[0].id,
                targetNodeId: nodes[1].id,
                timestamp: new Date().getTime(),
                isVisible: true,
                eventId: event['event_id'],
            });
        }).then(() => LogService.info("Voyager", "Invite succeeded to room " + roomId));
    }

    private onJoin(roomId: string, event: any) {
        // TODO: Queue room
        LogService.info("Voyager", "Joined room " + roomId);
    }

    private onLeave(roomId: string, event: any) {
        if (event['sender'] === VoyagerBot.userId) {
            // Probably a self kick or operator action
            // TODO: Record soft kick (#160)
        } else if (event['content'] && event['content']['membership'] === 'ban') {
            // Banned
            this.addKickBan(roomId, event, 'ban');
        } else if (event['unsigned'] && event['unsigned']['prev_content'] && event['unsigned']['prev_content']['membership'] === 'ban') {
            // TODO: Handle unbanned state?
            LogService.info("Voyager", event['sender'] + " has unbanned us in " + roomId);
        } else {
            // Kicked
            this.addKickBan(roomId, event, 'kick');
        }
    }

    private addKickBan(roomId: string, event: any, type: 'kick' | 'ban') {
        LogService.info("Voyager", "Recording " + type + " for room " + roomId + " made by " + event['sender']);

        Promise.all([this.getNode(event['sender'], 'user'), this.getNode(roomId, 'room')]).then(nodes => {
            nodes[1].isRedacted = true;
            // TODO: Record link_added event
            return Promise.all([nodes[1].save(), Link.create({
                type: type,
                sourceNodeId: nodes[0].id,
                targetNodeId: nodes[1].id,
                timestamp: new Date().getTime(),
                isVisible: false, // kicks and bans are not visible
                eventId: event['event_id'],
            })]);
        }).then(() => LogService.info("Voyager", "Recorded " + type + " for room " + roomId));
    }

    private onMessage(roomId: string, event: any) {
        if (event['sender'] === VoyagerBot.userId) return; // Ignore echo
        if (!event['content'] || !event['content']['body']) return; // Probably redacted

        const body = event['content']['body'];
        if (body.startsWith("!voyager")) {
            CommandHandler.handleCommand(roomId, event, body.substring("!voyager".length).trim().split(" "));
        } else {
            VoyagerStore.isUserTrackable(event['sender']).then(canTrack => {
                if (!canTrack) {
                    LogService.warn("Voyager", "Received message from " + event['sender'] + " however they are on the do not track list.");
                    return; // Stop processing.
                }

                const matches = body.match(/[#!][a-zA-Z0-9.\-_#=]+:[a-zA-Z0-9.\-_]+[a-zA-Z0-9]/g);
                if (!matches) return;

                return Promise.all(matches.map(m => this.processMatch(roomId, event, m)))
                    .then(() => VoyagerBot.sendReadReceipt(roomId, event['event_id']));
            })
        }
    }

    private processMatch(roomId: string, event: any, matched: string): Promise<any> {
        return joinRoom(matched).then(joinedRoomId => {
            return Promise.all([this.getNode(roomId, 'room'), this.getNode(joinedRoomId, 'room')]);
        }).then(nodes => {
            // TODO: Record link_added event
            return Link.create({
                type: "message",
                sourceNodeId: nodes[0].id,
                targetNodeId: nodes[1].id,
                timestamp: new Date().getTime(),
                isVisible: true,
                eventId: event['event_id'],
            });
        }).then(() => LogService.info("Voyager", "Created message link from " + roomId + " to " + matched));
    }

    public getNode(objectId: string, type: string): Promise<GraphNode> {
        return GraphNode.findOne({where: {objectId: objectId, type: type}}).then(node => {
            if (!node) {
                // TODO: Record node_created event
                return GraphNode.create({
                    type: type,
                    objectId: objectId,
                    isReal: true,
                    isRedacted: false,
                    isPublic: false,
                    displayName: "",
                    avatarUrl: "",
                    firstTimestamp: new Date().getTime(),
                });
            }

            return node;
        });
    }

    public sendPilledMessage(roomId: string, userId: string, message: string): Promise<any> {
        return VoyagerBot.getUserProfile(userId).then(profile => {
            const displayName = profile['displayname'] || userId;

            const htmlVersion = "<a href=\"https://matrix.to/#/" + userId + "\">" + displayName + "</a>: " + message;
            const textVersion = displayName + ": " + message;

            return VoyagerBot.sendMessage(roomId, {
                msgtype: "m.notice",
                format: "org.matrix.custom.html",
                body: textVersion,
                formatted_body: htmlVersion,
            });
        });
    }
}

export const Voyager = new _Voyager();