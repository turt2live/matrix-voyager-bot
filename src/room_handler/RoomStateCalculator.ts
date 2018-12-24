import { MatrixClient } from "matrix-bot-sdk";
import { VoyagerConfig } from "../VoyagerConfig";
import * as ColorHash from "color-hash";
import * as url from "url";
import { downloadFromUrl } from "../util";
import { AvatarCache } from "./AvatarCache";

const DEFAULT_ROOM_NAME = "Unnamed room";
const COLOR_HASH = new ColorHash({lightness: 0.66});

export interface IRoomState {
    id: string;
    friendlyId: string;
    displayName: string;
    avatarMxc: string;
    isPublic: boolean;
    numUsers: number;
    numServers: number;
    numAliases: number;
}

export class RoomStateCalculator {

    private client: MatrixClient;

    constructor(private roomId: string) {
        this.client = new MatrixClient(VoyagerConfig.matrix.homeserverUrl, VoyagerConfig.appservice.asToken);
    }

    public async getState(): Promise<IRoomState> {
        const state = await this.client.getRoomState(this.roomId);
        return {
            id: this.roomId,
            friendlyId: this.pickAlias(state),
            displayName: this.calculateName(state),
            avatarMxc: await this.calculateAvatar(state),
            isPublic: this.calculatePublicity(state),
            numUsers: this.countUsers(state),
            numServers: this.countServers(state),
            numAliases: this.countAliases(state),
        };
    }

    private pickAlias(state: any[]): string {
        // Try to use the canonical alias first
        const canonicalAliasEvt = state.find(e => e["type"] === "m.room.canonical_alias" && e["state_key"] === "");
        if (canonicalAliasEvt && canonicalAliasEvt["content"] && canonicalAliasEvt["content"]["alias"]) {
            return canonicalAliasEvt["content"]["alias"];
        }

        const aliasEvents = state.filter(e => e["type"] === "m.room.aliases");

        // Then use a matrix.org alias if we can
        const matrixDotOrgAliases = aliasEvents.find(e => e["state_key"] === "matrix.org");
        if (matrixDotOrgAliases && matrixDotOrgAliases["content"] && matrixDotOrgAliases["content"]["aliases"] && matrixDotOrgAliases["content"]["aliases"].length) {
            return matrixDotOrgAliases["content"]["aliases"][0];
        }

        // Failing that, use whatever alias we can find
        const thirdPartyAlias = aliasEvents.find(e => e["content"] && e["content"]["aliases"] && e["content"]["aliases"].length);
        if (thirdPartyAlias) return thirdPartyAlias["content"]["aliases"][0];

        // Fall back to the room ID
        return this.roomId;
    }

    private calculateName(state: any[]): string {
        // Start with using the name event
        const roomNameEvt = state.find(e => e["type"] === "m.room.name" && e["state_key"] === "");
        if (roomNameEvt && roomNameEvt["content"] && roomNameEvt["content"]["name"]) {
            return roomNameEvt["content"]["name"];
        }

        // Then pick an alias
        const alias = this.pickAlias(state);
        if (alias && alias !== this.roomId) return alias;

        // Finally, fall back to just "Unnamed room". We won't bother calculating the
        // member-based name because it is so rare to end up in this state.
        return DEFAULT_ROOM_NAME;
    }

    private async calculateAvatar(state: any[]): Promise<string> {
        // Start with using the avatar event
        const roomAvatarEvt = state.find(e => e["type"] === "m.room.avatar" && e["state_key"] === "");
        if (roomAvatarEvt && roomAvatarEvt["content"] && roomAvatarEvt["content"]["url"]) {
            return roomAvatarEvt["content"]["url"];
        }

        // Try and generate one on behalf of the room instead
        const name = this.calculateName(state);
        const hex = COLOR_HASH.hex(name).substring(1);
        const avatarUrl = url.resolve(VoyagerConfig.misc.uiAvatarsUrl, `/api?color=fff&size=512&background=${hex}&name=${name.startsWith('#') ? name.substring(1)[0] : name[0]}`);

        const existingAvatar = AvatarCache.getMxcForUrl(avatarUrl);
        if (existingAvatar) return existingAvatar;

        const buf = await downloadFromUrl(avatarUrl);
        const mxc = await this.client.uploadContent(buf, "image/png");
        AvatarCache.setMxcForUrl(avatarUrl, mxc);
        return mxc;
    }

    private calculatePublicity(state: any[]): boolean {
        const joinRulesEvt = state.find(e => e["type"] === "m.room.join_rules" && e["state_key"] === "");
        if (!joinRulesEvt || !joinRulesEvt["content"] || joinRulesEvt["content"]["join_rule"] !== "public") {
            return false;
        }

        const alias = this.pickAlias(state);
        return alias && alias !== this.roomId;
    }

    private countUsers(state: any[]): number {
        const joinedMembers = state.filter(e => e["type"] === "m.room.member" && e["state_key"] && e["content"] && e["content"]["membership"] === "join");
        return joinedMembers.length;
    }

    private countServers(state: any[]): number {
        const countedServers = {};

        const tryCountEntity = (entity: string) => {
            const server = entity.split(':').splice(1).join(':');
            if (!server) return;
            countedServers[server] = true;
        };

        state.forEach(e => {
            tryCountEntity(e["sender"]);
            if (e["type"] === "m.room.member") tryCountEntity(e["state_key"]);
            if (e["type"] === "m.room.aliases") tryCountEntity("@:" + e["state_key"]);
        });

        return Object.keys(countedServers).length;
    }

    private countAliases(state: any[]): number {
        const countedAliases = {};

        const canonicalAliasEvt = state.find(e => e["type"] === "m.room.canonical_alias" && e["state_key"] === "");
        if (canonicalAliasEvt && canonicalAliasEvt["content"] && canonicalAliasEvt["content"]["alias"]) {
            countedAliases[canonicalAliasEvt["content"]["alias"]] = true;
        }

        const aliasEvents = state.filter(e => e["type"] === "m.room.aliases" && e["state_key"]);
        for (const evt of aliasEvents) {
            if (!evt["content"] || !evt["content"]["aliases"] || !evt["content"]["aliases"].length) continue;
            evt["content"]["aliases"].forEach(a => countedAliases[a] = true);
        }

        return Object.keys(countedAliases).length;
    }
}