import { IWorker } from "../IWorker";
import { Appservice, IAppserviceRegistration, SimpleFsStorageProvider, SimpleRetryJoinStrategy } from "matrix-bot-sdk";
import { VoyagerConfig } from "../VoyagerConfig";
import * as escapeStringRegexp from "escape-string-regexp";
import * as mkdirp from "mkdirp";
import * as path from "path";

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
    }

    start(): Promise<any> {
        return this.appservice.begin();
    }

    /**
     * Generates an appservice registration from the runtime configuration.
     * @returns {IAppserviceRegistration} the registration
     */
    static generateRegistrationFromConfig(): IAppserviceRegistration {
        return <any>{
            id: "voyager",
            hsToken: VoyagerConfig.appservice.hsToken,
            asToken: VoyagerConfig.appservice.asToken,
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
