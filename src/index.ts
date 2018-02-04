import { LogService } from "matrix-js-snippets";
import config from "./config";
import { VoyagerStore } from "./db/voyager_store";
import VoyagerBot from "./matrix/default_client";

LogService.configure(config.logging);
LogService.info("index", "Starting voyager...");

VoyagerStore.updateSchema()
    .then(() => VoyagerBot.start())
    .then(() => {
        LogService.info("index", "Voyager started and ready to go!");
    });