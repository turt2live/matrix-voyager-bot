import { Voyager } from "../voyager";
import * as Promise from "bluebird";

export function RemoveMeCommand(roomId: string, event: any, cmdArguments: string[]): Promise<any> {
    return Voyager.getNode(event['sender'], 'user').then(user => {
        if (!user.isPublic) {
            return Voyager.sendPilledMessage(roomId, event['sender'], "You are already hidden from the graph");
        } else {
            user.isPublic = false;
            return user.save().then(() => Voyager.sendPilledMessage(roomId, event['sender'], "You are now removed from the graph"));
        }
    });
}