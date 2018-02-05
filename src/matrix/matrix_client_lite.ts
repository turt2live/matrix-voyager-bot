import { LocalStorage } from "node-localstorage";
import * as mkdirp from "mkdirp";
import { LogService } from "matrix-js-snippets";
import FilterTemplate from "./filter_template";
import * as request from "request";
import * as Promise from "bluebird";
import { EventEmitter } from "events";

/**
 * Represents a lightweight matrix client with minimal functionality. Fires the following events:
 * * "room.leave" (roomId, leaveEvent) - only fired for the current user
 * * "room.join" (roomId) - only fired for the current user
 * * "room.invite" (roomId, inviteEvent) - only fired for the current user
 * * "room.message" (roomId, messageEvent) - only fired for joined rooms
 */
export default class MatrixLiteClient extends EventEmitter {

    public userId: string;

    private kvStore: Storage;
    private requestId = 0;
    private filterId = 0;
    private stopSyncing = false;
    private lastJoinedRoomIds = [];

    /**
     * Creates a new matrix client
     * @param {string} homeserverUrl The homeserver's client-server URL
     * @param {string} accessToken The access token to authenticate with
     */
    constructor(private homeserverUrl: string, private accessToken: string) {
        super();

        if (this.homeserverUrl.endsWith("/"))
            this.homeserverUrl = this.homeserverUrl.substring(0, this.homeserverUrl.length - 2);

        mkdirp.sync("db");
        this.kvStore = new LocalStorage("db/mtx_client_lite_localstorage", 100 * 1024 * 1024); // quota is 100mb
    }

    public getUserId(): Promise<string> {
        if (this.userId) return Promise.resolve(this.userId);

        return this.do("GET", "/_matrix/client/r0/account/whoami").then(response => {
            this.userId = response["user_id"];
            return this.userId;
        });
    }

    public start(filter: any = null): Promise<any> {
        if (!filter || typeof(filter) !== "object") {
            LogService.verbose("MatrixClientLite", "No filter given or invalid object - using defaults.");
            filter = FilterTemplate;
        }

        return this.getUserId().then(userId => {
            let createFilter = false;

            let existingFilter = this.kvStore.getItem("m.filter");
            if (existingFilter) {
                let activeFilter = JSON.parse(existingFilter);
                LogService.verbose("MatrixClientLite", "Found existing filter. Checking consistency with given filter");
                if (JSON.stringify(activeFilter['filter']) === JSON.stringify(filter)) {
                    LogService.verbose("MatrixClientLite", "Filters match");
                    this.filterId = activeFilter['id'];
                } else {
                    createFilter = true;
                }
            } else {
                createFilter = true;
            }

            if (createFilter) {
                LogService.verbose("MatrixClientLite", "Creating new filter");
                return this.do("POST", "/_matrix/client/r0/user/" + userId + "/filter", null, filter).then(response => {
                    this.filterId = response["filter_id"];
                    this.kvStore.removeItem("m.synctoken"); // new filter == new token
                    this.kvStore.setItem("m.filter", JSON.stringify({
                        id: this.filterId,
                        filter: filter,
                    }));
                });
            }
        }).then(() => {
            LogService.verbose("MatrixClientLite", "Starting sync with filter ID " + this.filterId);
            this.startSync();
        });
    }

    private startSync() {
        let token = this.kvStore.getItem("m.synctoken");

        const promiseWhile = Promise.method(() => {
            if (this.stopSyncing) {
                LogService.info("MatrixClientLite", "Client stop requested - stopping sync");
                return;
            }

            return this.doSync(token).then(response => {
                token = response["next_batch"];
                this.kvStore.setItem("m.synctoken", token);
                LogService.info("MatrixClientLite", "Received sync. Next token: " + token);

                this.processSync(response);
            }, () => null).then(promiseWhile.bind(this)); // errors are already reported, so suppress them here.
        });

        promiseWhile(); // start the loop
    }

    private doSync(token: string): Promise<any> {
        LogService.info("MatrixClientLite", "Performing sync with token " + token);
        const conf = {
            filter: this.filterId,
            full_state: false,
            timeout: 10000,
        };
        if (token) conf["since"] = token; // synapse complains if the variable is null, so we have to have it unset instead

        // timeout is 30s if we have a token, otherwise 10min
        return this.do("GET", "/_matrix/client/r0/sync", conf, null, (token ? 30000 : 600000));
    }

    private processSync(raw: any) {
        if (!raw || !raw['rooms']) return; // nothing to process

        let leftRooms = raw['rooms']['leave'] || {};
        let inviteRooms = raw['rooms']['invite'] || {};
        let joinedRooms = raw['rooms']['join'] || {};

        // Process rooms we've left first
        for (let roomId in leftRooms) {
            const room = leftRooms[roomId];
            if (!room['timeline'] || !room['timeline']['events']) continue;

            let leaveEvent = null;
            for (let event of room['timeline']['events']) {
                if (event['type'] !== 'm.room.member') continue;
                if (event['state_key'] !== this.userId) continue;

                const oldAge = leaveEvent && leaveEvent['unsigned'] && leaveEvent['unsigned']['age'] ? leaveEvent['unsigned']['age'] : 0;
                const newAge = event['unsigned'] && event['unsigned']['age'] ? event['unsigned']['age'] : 0;
                if (leaveEvent && oldAge < newAge) continue;

                leaveEvent = event;
            }

            if (!leaveEvent) {
                LogService.warn("MatrixClientLite", "Left room " + roomId + " without receiving an event");
                continue;
            }

            this.emit("room.leave", roomId, leaveEvent);
        }

        // Process rooms we've been invited to
        for (let roomId in inviteRooms) {
            const room = inviteRooms[roomId];
            if (!room['invite_state'] || !room['invite_state']['events']) continue;

            let inviteEvent = null;
            for (let event of room['invite_state']['events']) {
                if (event['type'] !== 'm.room.member') continue;
                if (event['state_key'] !== this.userId) continue;
                if (event['membership'] !== "invite") continue;

                const oldAge = inviteEvent && inviteEvent['unsigned'] && inviteEvent['unsigned']['age'] ? inviteEvent['unsigned']['age'] : 0;
                const newAge = event['unsigned'] && event['unsigned']['age'] ? event['unsigned']['age'] : 0;
                if (inviteEvent && oldAge < newAge) continue;

                inviteEvent = event;
            }

            if (!inviteEvent) {
                LogService.warn("MatrixClientLite", "Invited to room " + roomId + " without receiving an event");
                continue;
            }

            this.emit("room.invite", roomId, inviteEvent);
        }

        // Process rooms we've joined and their events
        for (let roomId in joinedRooms) {
            if (this.lastJoinedRoomIds.indexOf(roomId) === -1) {
                this.emit("room.join", roomId);
                this.lastJoinedRoomIds.push(roomId);
            }

            const room = joinedRooms[roomId];
            if (!room['timeline'] || !room['timeline']['events']) continue;

            for (let event of room['timeline']['events']) {
                if (event['type'] === 'm.room.message') this.emit("room.message", roomId, event);
                else LogService.silly("MatrixClientLite", "Not handling event " + event['type']);
            }
        }
    }

    /**
     * Gets the room state for the given room. Returned as raw events.
     * @param {string} roomId the room ID to get state for
     * @returns {Promise<*[]>} resolves to the room's state
     */
    public getRoomState(roomId: string): Promise<any[]> {
        return this.do("GET", "/_matrix/client/r0/rooms/" + roomId + "/state");
    }

    /**
     * Gets the state events for a given room of a given type under the given state key.
     * @param {string} roomId the room ID
     * @param {string} type the event type
     * @param {String} stateKey the state key, falsey if not needed
     * @returns {Promise<*|*[]>} resolves to the state event(s)
     */
    public getRoomStateEvents(roomId, type, stateKey): Promise<any | any[]> {
        return this.do("GET", "/_matrix/client/r0/rooms/" + roomId + "/state/" + type + "/" + (stateKey ? stateKey : ''));
    }

    /**
     * Gets the profile for a given user
     * @param {string} userId the user ID to lookup
     * @returns {Promise<*>} the profile of the user
     */
    public getUserProfile(userId: string): Promise<any> {
        return this.do("GET", "/_matrix/client/r0/profile/" + userId);
    }

    /**
     * Joins the given room
     * @param {string} roomIdOrAlias the room ID or alias to join
     * @returns {Promise<string>} resolves to the joined room ID
     */
    public joinRoom(roomIdOrAlias: string): Promise<string> {
        roomIdOrAlias = encodeURIComponent(roomIdOrAlias);
        return this.do("POST", "/_matrix/client/r0/join/" + roomIdOrAlias).then(response => {
            return response['room_id'];
        });
    }

    /**
     * Gets a list of joined room IDs
     * @returns {Promise<string[]>} resolves to a list of room IDs the client participates in
     */
    public getJoinedRooms(): Promise<string[]> {
        return this.do("GET", "/_matrix/client/r0/joined_rooms").then(response => response['joined_rooms']);
    }

    /**
     * Leaves the given room
     * @param {string} roomId the room ID to leave
     * @returns {Promise<*>} resolves when left
     */
    public leaveRoom(roomId: string): Promise<any> {
        return this.do("POST", "/_matrix/client/r0/rooms/" + roomId + "/leave");
    }

    /**
     * Sends a read receipt for an event in a room
     * @param {string} roomId the room ID to send the receipt to
     * @param {string} eventId the event ID to set the receipt at
     * @returns {Promise<*>} resolves when the receipt has been sent
     */
    public sendReadReceipt(roomId: string, eventId: string): Promise<any> {
        return this.do("POST", "/_matrix/client/r0/rooms/" + roomId + "/receipt/m.read/" + eventId);
    }

    /**
     * Sends a notice to the given room
     * @param {string} roomId the room ID to send the notice to
     * @param {string} text the text to send
     * @returns {Promise<string>} resolves to the event ID that represents the message
     */
    public sendNotice(roomId: string, text: string): Promise<string> {
        const txnId = (new Date().getTime()) + "__REQ" + this.requestId;
        return this.do("PUT", "/_matrix/client/r0/rooms/" + roomId + "/send/m.room.message/" + txnId, null, {
            body: text,
            msgtype: "m.notice"
        }).then(response => {
            return response['event_id'];
        });
    }

    /**
     * Sends a message to the given room
     * @param {string} roomId the room ID to send the notice to
     * @param {string} content the event body to send
     * @returns {Promise<string>} resolves to the event ID that represents the message
     */
    public sendMessage(roomId: string, content: any): Promise<string> {
        const txnId = (new Date().getTime()) + "__REQ" + this.requestId;
        return this.do("PUT", "/_matrix/client/r0/rooms/" + roomId + "/send/m.room.message/" + txnId, null, content).then(response => {
            return response['event_id'];
        });
    }

    /**
     * Converts a media URI to a thumbnail URL
     * @param {string} mxcUri the mxc uri
     * @param {number} width the width in pixels for the thumbnail
     * @param {number} height the height in pixels for the thumbnail
     * @returns {string} the URL to get the thumbnail at
     */
    public convertMediaToThumbnail(mxcUri: string, width: number, height: number): string {
        const shorthand = mxcUri.substring("mxc://".length).split("?")[0].split("#")[0]; // split off path components

        // shorthand is serverName/mediaId (which matches the URL format)
        return this.homeserverUrl + "/_matrix/media/r0/thumbnail/" + shorthand + "?width=" + width + "&height=" + height;
    }

    private do(method, endpoint, qs = null, body = null, timeout = 60000, raw = false): Promise<any> {
        if (!endpoint.startsWith('/'))
            endpoint = '/' + endpoint;

        const requestId = ++this.requestId;
        const url = this.homeserverUrl + endpoint;

        LogService.verbose("MatrixLiteClient (REQ-" + requestId + ")", method + " " + url);

        if (qs) LogService.verbose("MatrixLiteClient (REQ-" + requestId + ")", "qs = " + JSON.stringify(qs));
        if (body) LogService.verbose("MatrixLiteClient (REQ-" + requestId + ")", "body = " + JSON.stringify(body));

        const params = {
            url: url,
            method: method,
            json: body,
            qs: qs,
            timeout: timeout,
            headers: {
                "Authorization": "Bearer " + this.accessToken,
            }
        };

        return new Promise((resolve, reject) => {
            request(params, (err, response, body) => {
                if (err) {
                    LogService.error("MatrixLiteClient (REQ-" + requestId + ")", err);
                    reject(err);
                } else {
                    if (typeof(body) === 'string') {
                        try {
                            body = JSON.parse(body);
                        } catch (e) {
                        }
                    }

                    LogService.verbose("MatrixLiteClient (REQ-" + requestId + " RESP-H" + response.statusCode + ")", response.body);
                    if (response.statusCode < 200 || response.statusCode >= 300) {
                        LogService.error("MatrixLiteClient (REQ-" + requestId + ")", response.body);
                        reject(response);
                    } else resolve(raw ? response : body);
                }
            });
        });
    }
}