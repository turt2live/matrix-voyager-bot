import { IWorker } from "../IWorker";
import {
    Appservice,
    IAppserviceRegistration,
    LogService,
    MatrixClient,
    SimpleFsStorageProvider,
    SimpleRetryJoinStrategy
} from "matrix-bot-sdk";
import { VoyagerConfig } from "../VoyagerConfig";
import * as escapeStringRegexp from "escape-string-regexp";
import * as mkdirp from "mkdirp";
import * as path from "path";
import { MqConnection } from "../mq/mq";
import {
    ICreateLink,
    IRoomStatePayload,
    TOPIC_LINKS,
    TOPIC_ROOM_STATE,
    TYPE_CREATE_LINK,
    TYPE_STATE_EVENT
} from "../mq/consts";

const RETRY_MATCH_JOIN_INTERVAL = 5000;
const RETRY_MATCH_MAXIMUM = 10;

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
    }

    private async setupAppservice() {
        const tempClient = new MatrixClient(VoyagerConfig.matrix.homeserverUrl, VoyagerConfig.appservice.asToken);
        const userId = await tempClient.getUserId();
        const userParts = userId.split(':');
        const localpart = userParts[0].substring(1);
        const domainName = userParts.slice(1).join(':');

        // Generate a registration and change the user namespace to make the bot-sdk
        // happy. It doesn't actually affect anything because we don't use intents.
        const registration = AppserviceWorker.generateRegistrationFromConfig(localpart, domainName);
        registration.namespaces.users = [{regex: '@.*:.*', exclusive: true}];

        this.appservice = new Appservice({
            homeserverUrl: VoyagerConfig.matrix.homeserverUrl,
            homeserverName: domainName,
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
        await this.setupAppservice();

        LogService.info("AppserviceWorker", "Getting joined rooms for bot...");
        this.joinedRooms = await this.appservice.botIntent.underlyingClient.getJoinedRooms();
        LogService.info("AppserviceWorker", `Bot resides in ${this.joinedRooms.length} rooms - starting normal routine`);

        return Promise.all([
            this.appservice.begin(),
            this.mq.start(),
        ]);
    }

    private handleEvent(roomId: string, event: any) {
        if (!event['content']) {
            LogService.warn("AppserviceWorker", "Received event without content (probably redacted) - ignoring");
            return;
        }

        if (event["type"] === "m.room.member" && event["state_key"] === this.appservice.botUserId) {
            return this.processMembershipEvent(roomId, event);
        }

        if (this.joinedRooms.indexOf(roomId) === -1) {
            LogService.warn("AppserviceWorker", "Received event for which the bot does not reside - ignoring");
            return;
        }

        if (event["type"] === "m.room.message" && !event['state_key'] && event['state_key'] !== '') {
            return this.processMessageEvent(roomId, event);
        }
        if (event["state_key"] || event["state_key"] === '') {
            return this.processStateEvent(roomId, event);
        }
    }

    private updateJoinedRooms(roomId: string, isJoined: boolean) {
        if (isJoined) {
            if (this.joinedRooms.indexOf(roomId) === -1) {
                this.joinedRooms.push(roomId);
            }
        } else {
            const idx = this.joinedRooms.indexOf(roomId);
            if (idx !== -1) this.joinedRooms.splice(idx, 1);
        }
    }

    private async processMembershipEvent(roomId: string, event: any) {
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
            this.updateJoinedRooms(roomId, true);
            LogService.info("AppserviceWorker", "Successfully joined a room");
            return await this.mq.sendPayload(TOPIC_ROOM_STATE, TYPE_STATE_EVENT, <IRoomStatePayload>{
                roomId: roomId,
                event: event,
            });
        } else if (membership === "leave") {
            this.updateJoinedRooms(roomId, false);
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
            this.updateJoinedRooms(roomId, false);
            LogService.info("AppserviceWorker", "Banned from a room");
            return await this.mq.sendPayload(TOPIC_LINKS, TYPE_CREATE_LINK, <ICreateLink>{
                from: {type: "user", id: event["sender"]},
                to: {type: "room", id: roomId},
                type: "ban",
                message: event["content"]["reason"],
            });
        }
    }

    private async processMessageEvent(roomId: string, event: any) {
        const body: string = event["content"]["body"];
        if (!body || event['sender'] === this.appservice.botUserId) return;

        if (body.startsWith("!voyager")) {
            LogService.info("AppserviceWorker", "COMMAND");
            //return this.processCommand(roomId, event);
        }

        // TODO: Match matrix.to links and parse ?via arguments
        const matches = body.match(/[#!][a-zA-Z0-9.\-_#=]+:[a-zA-Z0-9.\-_]+[a-zA-Z0-9]/g);
        if (!matches) return;

        for (const match of matches) {
            // noinspection JSIgnoredPromiseFromCall
            this.processMatch(roomId, event, match);
        }

        await this.appservice.botIntent.underlyingClient.sendReadReceipt(roomId, event["event_id"]);
    }

    private processStateEvent(roomId: string, event: any) {
        LogService.info("AppserviceWorker", "Broadcasting receipt of generic state event");
        return this.mq.sendPayload(TOPIC_ROOM_STATE, TYPE_STATE_EVENT, <IRoomStatePayload>{
            roomId: roomId,
            event: event,
        });
    }

    private async processMatch(roomId: string, event: any, match: string, retryCount = 0) {
        if (retryCount > RETRY_MATCH_MAXIMUM) {
            LogService.warn("AppserviceWorker", `Failed to process match ${match} in ${roomId}`);
            return;
        }
        try {
            LogService.info("AppserviceWorker", `Processing match ${match} in ${roomId}`);

            const targetRoomId = await this.appservice.botIntent.underlyingClient.resolveRoom(match);
            if (!targetRoomId) {
                LogService.warn("AppserviceWorker", `No resulting room ID for ${match} - retrying`);
                setTimeout(() => this.processMatch(roomId, event, match, retryCount++), RETRY_MATCH_JOIN_INTERVAL);
                return;
            }

            if (this.joinedRooms.indexOf(targetRoomId) === -1) {
                await this.appservice.botIntent.joinRoom(match);
            } else {
                LogService.info("AppserviceWorker", `Already joined to ${targetRoomId} - skipping join`);
            }

            await this.mq.sendPayload(TOPIC_LINKS, TYPE_CREATE_LINK, <ICreateLink>{
                from: {type: "room", id: roomId},
                to: {type: "room", id: targetRoomId},
                type: "message",
                message: match,
            });
            LogService.info("AppserviceWorker", `Linked ${match} (${targetRoomId}) to ${roomId} as type 'message'`);
        } catch (e) {
            LogService.error("AppserviceWorker", `Error processing match ${match} in ${roomId} - retrying`);
            LogService.error("AppserviceWorker", e);
            setTimeout(() => this.processMatch(roomId, event, match, retryCount++), RETRY_MATCH_JOIN_INTERVAL);
        }
    }

    /**
     * Generates an appservice registration from the runtime configuration.
     * @param localpart {string} the user's localpart
     * @param domainName {string} the user's domain name
     * @returns {IAppserviceRegistration} the registration
     */
    static generateRegistrationFromConfig(localpart: string, domainName: string): IAppserviceRegistration {
        return {
            id: "voyager",
            hs_token: VoyagerConfig.appservice.hsToken,
            as_token: VoyagerConfig.appservice.asToken,
            url: `http://localhost:${VoyagerConfig.web.port}`,
            sender_localpart: localpart,
            namespaces: {
                users: [{
                    exclusive: true,
                    regex: escapeStringRegexp(`@${localpart}:${domainName}`),
                }],
                rooms: [],
                aliases: [],
            },
        };
    }
}
