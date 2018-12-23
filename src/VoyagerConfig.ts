import * as config from "config";
import { LogConfig } from "matrix-js-snippets";

interface IVoyagerConfig {
    matrix: {
        homeserverUrl: string;
        homeserverName: string;
        userLocalpart: string;
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
    };
    logging: LogConfig;
}

export const VoyagerConfig = <IVoyagerConfig>config;