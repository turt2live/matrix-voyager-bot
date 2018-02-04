import { LogService } from "matrix-js-snippets";
import config from "./config";
import { VoyagerStore } from "./db/voyager_store";
import VoyagerBot from "./matrix/default_client";
import Voyager from "./bot/voyager";

LogService.configure(config.logging);
LogService.info("index", "Starting voyager...");

VoyagerStore.updateSchema()
    .then(() => VoyagerBot.start())
    .then(() => Voyager.start())
    .then(() => {
        LogService.info("index", "Voyager started and ready to go!");
    });