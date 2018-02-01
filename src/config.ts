import * as config from "config";
import { LogConfig } from "matrix-js-snippets";

export interface VoyagerConfig {
    matrix: {
        homeserverUrl: string;
        accessToken: string;
    };
    web: {
        port: number;
        address: string;
    };
    database: {
        host: string;
        port: number;
        username: string;
        password: string;
        database: string;
    };
    logging: LogConfig;
}

export default <VoyagerConfig>config;