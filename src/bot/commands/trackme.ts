import { Voyager } from "../voyager";
import { VoyagerStore } from "../../db/voyager_store";
import * as Promise from "bluebird";

export function TrackMeCommand(roomId: string, event: any, cmdArguments: string[]): Promise<any> {
    return VoyagerStore.getUser(event['sender']).then(user => {
        if (!user.doNotTrack) {
            return Voyager.sendPilledMessage(roomId, event['sender'], "I will follow room mentions in your messages");
        } else {
            user.doNotTrack = false;
            return user.save().then(() => Voyager.sendPilledMessage(roomId, event['sender'], "I'll resume following room mentions in your messages"));
        }
    });
}