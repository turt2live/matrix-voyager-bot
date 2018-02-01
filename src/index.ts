import { LogService } from "matrix-js-snippets";
import config from "./config";
import { VoyagerStore } from "./db/voyager_store";

LogService.configure(config.logging);
LogService.info("index", "Starting voyager...");

VoyagerStore.updateSchema();