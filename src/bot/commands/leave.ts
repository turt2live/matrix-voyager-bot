import VoyagerBot from "../../matrix/default_client";
import { Voyager } from "../voyager";
import Link from "../../models/link";
import * as Promise from "bluebird";

export function LeaveCommand(roomId: string, event: any, cmdArguments: string[]): Promise<any> {
    return VoyagerBot.getRoomStateEvents(roomId, "m.room.power_levels", "").then(plEvent => {
        if (!plEvent) {
            return Voyager.sendPilledMessage(roomId, event['sender'], "There is no m.room.power_levels event in your room");
        }

        let plUser = plEvent['users'] ? plEvent['users'][event['sender']] : null;
        if (!plUser && plUser !== 0) plUser = plEvent['users_default'];
        if (!plUser && plUser !== 0) plUser = 0; // Default

        let plKick = plEvent['kick'];
        if (!plKick && plKick !== 0) plKick = plEvent['state_default'];
        if (!plKick && plKick !== 0) plKick = 50; // Default

        if (plUser < plKick) {
            return Voyager.sendPilledMessage(roomId, event['sender'], "You do not have the required power level to kick people from this room");
        }

        return Promise.all([Voyager.getNode(event['sender'], 'user'), Voyager.getNode(roomId, 'room')]).then(nodes => {
            return Link.create({
                type: "soft_kick",
                sourceNodeId: nodes[0].id,
                targetNodeId: nodes[1].id,
                timestamp: new Date().getTime(),
                isVisible: false,
                eventId: event['event_id'],
            });
        }).then(() => VoyagerBot.leaveRoom(roomId));
    });
}