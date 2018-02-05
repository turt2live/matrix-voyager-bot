import { Voyager } from "../voyager";
import { VoyagerStore } from "../../db/voyager_store";
import * as Promise from "bluebird";

export function DntCommand(roomId: string, event: any, cmdArguments: string[]): Promise<any> {
    return VoyagerStore.getUser(event['sender']).then(user => {
        if (user.doNotTrack) {
            return Voyager.sendPilledMessage(roomId, event['sender'], "I'm not following room mentions in your messages");
        } else {
            user.doNotTrack = true;
            return user.save().then(() => Voyager.sendPilledMessage(roomId, event['sender'], "I'll stop following room mentions in your messages"));
        }
    });
}