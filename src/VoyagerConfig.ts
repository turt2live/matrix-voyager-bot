import * as config from "config";
import { LogConfig } from "matrix-js-snippets";

interface IVoyagerConfig {
    matrix: {
        homeserverUrl: string;
    };
    appservice: {
        asToken: string;
        hsToken: string;
    };
    web: {
        bindAddress: string;
        port: number;
    };
    data: {
        appservice: string;
        avatarCache: string;
        postgres: string;
    };
    rabbitmq: {
        protocol: string;
        host: string;
        port: number;
        user: string;
        password: string;
        vhost: string;
        exchange: string;
        deadLetterExchange: string;
        deadLetterQueue: string;
    };
    misc: {
        uiAvatarsUrl: string;
    };
    logging: LogConfig;
}

export const VoyagerConfig = <IVoyagerConfig>config;