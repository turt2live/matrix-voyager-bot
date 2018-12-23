import { IWorker } from "../IWorker";
import { Appservice, IAppserviceRegistration, SimpleFsStorageProvider, SimpleRetryJoinStrategy } from "matrix-bot-sdk";
import { VoyagerConfig } from "../VoyagerConfig";
import * as escapeStringRegexp from "escape-string-regexp";
import * as mkdirp from "mkdirp";
import * as path from "path";
import { LogService } from "matrix-js-snippets";

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

    private appservice: Appservice;

    constructor() {
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

    start(): Promise<any> {
        return this.appservice.begin();
    }

    private handleEvent(roomId: string, event: any) {
        if (event["type"] === "m.room.member" && event["state_key"] === this.appservice.botUserId) {
            this.processMembershipEvent(roomId, event);
        }
        if (event["type"] === "m.room.message" && event["content"]) {
            this.processMessageEvent(roomId, event);
        }
        if (event["state_key"] || event["state_key"] === '') {
            this.processStateEvent(roomId, event);
        }
    }

    private processMembershipEvent(roomId: string, event: any) {
        if (!event["content"]) return;

        const membership = event["content"]["membership"];
        if (membership === "invite") {
            LogService.info("AppserviceWorker", "RECEIVED INVITE");
            this.appservice.botIntent.joinRoom(roomId);
        } else if (membership === "join") {
            LogService.info("AppserviceWorker", "JOINED ROOM");
        } else if (membership === "leave") {
            if (event["sender"] !== event["state_key"]) {
                LogService.info("AppserviceWorker", "KICKED FROM ROOM");
            } else {
                LogService.info("AppserviceWorker", "LEFT ROOM PEACEFULLY");
            }
        } else if (membership === "ban") {
            LogService.info("AppserviceWorker", "BANNED FROM ROOM");
        }
    }

    private processMessageEvent(roomId: string, event: any) {
        LogService.info("AppserviceWorker", "TODO: Process message");
    }

    private processStateEvent(roomId: string, event: any) {
        LogService.info("AppserviceWorker", "TODO: Process state event");
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
