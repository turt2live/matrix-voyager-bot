import { Voyager } from "../voyager";
import * as Promise from "bluebird";

export function AddMeCommand(roomId: string, event: any, cmdArguments: string[]): Promise<any> {
    return Voyager.getNode(event['sender'], 'user').then(user => {
        if (user.isPublic) {
            return Voyager.sendPilledMessage(roomId, event['sender'], "You are already public on the graph");
        } else {
            user.isPublic = true;
            return user.save().then(() => Voyager.sendPilledMessage(roomId, event['sender'], "You are now public on the graph"));
        }
    });
}