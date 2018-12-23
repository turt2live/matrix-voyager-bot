import { LogService } from "matrix-js-snippets";
import { VoyagerConfig } from "./VoyagerConfig";
import * as program from "commander";
import { IWorkerFactory } from "./IWorker";
import { AppserviceWorker, NewAppserviceWorker } from "./appservice/worker";
import * as yaml from "js-yaml";
import * as fs from "fs";

LogService.configure(VoyagerConfig.logging);
LogService.info("index", "Starting Voyager");

program
    .version("2.0.0") // TODO: Make this dynamic
    .option('-w, --worker [name]', 'The worker to run')
    .option('-g, --generate-registration <file_name>', 'Generate a registration file from the configuration. Does not start a worker.')
    .parse(process.argv);

if (program.generateRegistration) {
    LogService.info("index", "Generating registration file...");
    const registration = AppserviceWorker.generateRegistrationFromConfig();
    const result = yaml.safeDump(registration);
    fs.writeFileSync(program.generateRegistration, result);
    LogService.info("index", "Registration file written! You may need to change the url property to point to Voyager correctly.");
    process.exit(0);
}

const knownWorkers: { [name: string]: IWorkerFactory } = {
    appservice: NewAppserviceWorker,
};

if (!(program.worker in knownWorkers)) {
    LogService.error("index", "Worker not found");
    process.exit(1);
}

(async function () {
    try {
        const worker = knownWorkers[program.worker]();
        await worker.start();
        LogService.info("index", `${program.worker} started`);
    } catch (e) {
        LogService.error("index", `Error starting worker ${program.worker}`);
        LogService.error("index", e);
        process.exit(2);
    }
})();