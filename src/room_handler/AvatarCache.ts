import * as lowdb from "lowdb";
import * as FileSync from "lowdb/adapters/FileSync";
import { VoyagerConfig } from "../VoyagerConfig";
import * as sha512 from "hash.js/lib/hash/sha/512";

export class AvatarCache {

    private static cache: any;

    private constructor() {
    }

    private static initCache() {
        const adapter = new FileSync(VoyagerConfig.data.avatarCache);
        AvatarCache.cache = lowdb(adapter);

        AvatarCache.cache.defaults({}).write();
    }

    public static getMxcForUrl(url: string): string {
        if (!AvatarCache.cache) AvatarCache.initCache();
        const key = sha512().update(url).digest('hex');
        return AvatarCache.cache.get(key).value();
    }

    public static setMxcForUrl(url: string, mxc: string) {
        if (!AvatarCache.cache) AvatarCache.initCache();
        const key = sha512().update(url).digest('hex');
        AvatarCache.cache.set(key, mxc).write();
    }
}