import * as lowdb from "lowdb";
import * as FileSync from "lowdb/adapters/FileSync";
import { VoyagerConfig } from "./VoyagerConfig";
import * as sha512 from "hash.js/lib/hash/sha/512";
import * as url from "url";
import * as ColorHash from "color-hash";
import { downloadFromUrl } from "./util";
import { MatrixClient } from "matrix-bot-sdk";

const COLOR_HASH = new ColorHash({lightness: 0.66});

export class AvatarCache {

    private static cache: any;

    private constructor() {
    }

    private static initCache() {
        const adapter = new FileSync(VoyagerConfig.data.avatarCache);
        AvatarCache.cache = lowdb(adapter);

        AvatarCache.cache.defaults({}).write();
    }

    public static async getMxcForItem(name: string): Promise<string> {
        const hex = COLOR_HASH.hex(name).substring(1);
        const avatarUrl = url.resolve(VoyagerConfig.misc.uiAvatarsUrl, `/api?color=fff&size=512&background=${hex}&name=${name.startsWith('#') ? name.substring(1)[0] : name[0]}`);

        const existingAvatar = AvatarCache.getMxcForUrl(avatarUrl);
        if (existingAvatar) return existingAvatar;

        const client = new MatrixClient(VoyagerConfig.matrix.homeserverUrl, VoyagerConfig.appservice.asToken);
        const buf = await downloadFromUrl(avatarUrl);
        const mxc = await client.uploadContent(buf, "image/png");
        AvatarCache.setMxcForUrl(avatarUrl, mxc);

        return mxc;
    }

    public static getMxcForUrl(resourceUrl: string): string {
        if (!AvatarCache.cache) AvatarCache.initCache();
        const key = sha512().update(resourceUrl).digest('hex');
        return AvatarCache.cache.get(key).value();
    }

    public static setMxcForUrl(resourceUrl: string, mxc: string) {
        if (!AvatarCache.cache) AvatarCache.initCache();
        const key = sha512().update(resourceUrl).digest('hex');
        AvatarCache.cache.set(key, mxc).write();
    }
}