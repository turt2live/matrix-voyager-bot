import { IWorker } from "../IWorker";
import { Appservice, IAppserviceRegistration, SimpleFsStorageProvider, SimpleRetryJoinStrategy } from "matrix-bot-sdk";
import { VoyagerConfig } from "../VoyagerConfig";
import * as escapeStringRegexp from "escape-string-regexp";
import * as mkdirp from "mkdirp";
import * as path from "path";
import { LogService } from "matrix-js-snippets";
import { MqConnection } from "../mq/mq";
import {
    ICreateLink,
    IRoomStatePayload,
    TOPIC_LINKS,
    TOPIC_ROOM_STATE,
    TYPE_CREATE_LINK,
    TYPE_STATE_EVENT
} from "../mq/consts";

/**
 * Creates an appservice worker
 * @constructor
 */
export function NewAppserviceWorker(): AppserviceWorker {
    return new AppserviceWorker();
}

/**
 * Represents an appservice worker. This worker is meant to be the point of
 * contact for the homeserver and distributes events to other workers.
 */
export class AppserviceWorker implements IWorker {

    private mq: MqConnection;
    private appservice: Appservice;
    private joinedRooms: string[] = [];

    constructor() {
        this.mq = new MqConnection();

        mkdirp.sync(path.normalize(path.join(VoyagerConfig.data.appservice, '..')));

        // Generate a registration and change the user namespace to make the bot-sdk
        // happy. It doesn't actually affect anything because we don't use intents.
        const registration = AppserviceWorker.generateRegistrationFromConfig();
        registration.namespaces.users = [{regex: '@.*:.*', exclusive: true}];

        this.appservice = new Appservice({
            homeserverUrl: VoyagerConfig.matrix.homeserverUrl,
            homeserverName: VoyagerConfig.matrix.homeserverName,
            storage: new SimpleFsStorageProvider(VoyagerConfig.data.appservice),
            bindAddress: VoyagerConfig.web.bindAddress,
            port: VoyagerConfig.web.port,
            joinStrategy: new SimpleRetryJoinStrategy(),
            registration: registration,
        });

        // We don't listen to any of the other appservice events because we have a .* user
        // namespace, which means events fire for *everything*.
        this.appservice.on("room.event", this.handleEvent.bind(this));
    }

    public async start(): Promise<any> {
        LogService.info("AppserviceWorker", "Getting joined rooms for bot...");
        this.joinedRooms = await this.appservice.botIntent.underlyingClient.getJoinedRooms();
        LogService.info("AppserviceWorker", `Bot resides in ${this.joinedRooms.length} rooms - starting normal routine`);

        return Promise.all([
            this.appservice.begin(),
            this.mq.start(),
        ]);
    }

    private handleEvent(roomId: string, event: any) {
        if (event["type"] === "m.room.member" && event["state_key"] === this.appservice.botUserId) {
            return this.processMembershipEvent(roomId, event);
        }

        if (this.joinedRooms.indexOf(roomId) === -1) {
            LogService.warn("AppserviceWorker", "Received event for which the bot does not reside - ignoring");
            return;
        }

        if (event["type"] === "m.room.message" && event["content"] && !event['state_key'] && event['state_key'] !== '') {
            return this.processMessageEvent(roomId, event);
        }
        if (event["state_key"] || event["state_key"] === '') {
            return this.processStateEvent(roomId, event);
        }
    }

    private async processMembershipEvent(roomId: string, event: any) {
        if (!event["content"]) return;

        const membership = event["content"]["membership"];
        if (membership === "invite") {
            LogService.info("AppserviceWorker", "Received invite to a room");
            await this.mq.sendPayload(TOPIC_LINKS, TYPE_CREATE_LINK, <ICreateLink>{
                from: {type: "user", id: event["sender"]},
                to: {type: "room", id: roomId},
                type: "invite",
            });
            return this.appservice.botIntent.joinRoom(roomId);
        } else if (membership === "join") {
            LogService.info("AppserviceWorker", "Successfully joined a room");
            return await this.mq.sendPayload(TOPIC_ROOM_STATE, TYPE_STATE_EVENT, <IRoomStatePayload>{
                roomId: roomId,
                event: event,
            });
        } else if (membership === "leave") {
            if (event["sender"] !== event["state_key"]) {
                LogService.info("AppserviceWorker", "Kicked from a room");
                return await this.mq.sendPayload(TOPIC_LINKS, TYPE_CREATE_LINK, <ICreateLink>{
                    from: {type: "user", id: event["sender"]},
                    to: {type: "room", id: roomId},
                    type: "kick",
                    message: event["content"]["reason"],
                });
            } else {
                LogService.info("AppserviceWorker", "Left peacefully from a room");
                return await this.mq.sendPayload(TOPIC_LINKS, TYPE_CREATE_LINK, <ICreateLink>{
                    from: {type: "user", id: event["sender"]},
                    to: {type: "room", id: roomId},
                    type: "leave",
                });
            }
        } else if (membership === "ban") {
            LogService.info("AppserviceWorker", "Banned from a room");
            return await this.mq.sendPayload(TOPIC_LINKS, TYPE_CREATE_LINK, <ICreateLink>{
                from: {type: "user", id: event["sender"]},
                to: {type: "room", id: roomId},
                type: "ban",
                message: event["content"]["reason"],
            });
        }
    }

    private processMessageEvent(roomId: string, event: any) {
        LogService.info("AppserviceWorker", "TODO: Process message");
    }

    private processStateEvent(roomId: string, event: any) {
        LogService.info("AppserviceWorker", "Broadcasting receipt of generic state event");
        return this.mq.sendPayload(TOPIC_ROOM_STATE, TYPE_STATE_EVENT, <IRoomStatePayload>{
            roomId: roomId,
            event: event,
        });
    }

    /**
     * Generates an appservice registration from the runtime configuration.
     * @returns {IAppserviceRegistration} the registration
     */
    static generateRegistrationFromConfig(): IAppserviceRegistration {
        return {
            id: "voyager",
            hs_token: VoyagerConfig.appservice.hsToken,
            as_token: VoyagerConfig.appservice.asToken,
            url: `http://localhost:${VoyagerConfig.web.port}`,
            sender_localpart: VoyagerConfig.matrix.userLocalpart,
            namespaces: {
                users: [{
                    exclusive: true,
                    regex: escapeStringRegexp(`@${VoyagerConfig.matrix.userLocalpart}:${VoyagerConfig.matrix.homeserverName}`),
                }],
                rooms: [],
                aliases: [],
            },
        };
    }
}
