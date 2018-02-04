import VoyagerBot from "../matrix/default_client";
import GraphNode from "../models/node";
import * as Promise from "bluebird";
import joinRoom from "./join_strategy";
import Link from "../models/link";
import { LogService } from "matrix-js-snippets";

class Voyager {

    constructor() {
    }

    public start() {
        VoyagerBot.on("room.invite", this.onInvite.bind(this));
        VoyagerBot.on("room.join", this.onJoin.bind(this));
        VoyagerBot.on("room.leave", this.onLeave.bind(this));
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

    private getNode(objectId: string, type: string): Promise<GraphNode> {
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
}

export default new Voyager() as Voyager;