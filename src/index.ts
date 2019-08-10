import { LogService, RichConsoleLogger } from "matrix-bot-sdk";
import { VoyagerConfig } from "./VoyagerConfig";
import * as program from "commander";
import { IWorkerFactory } from "./IWorker";
import { AppserviceWorker, NewAppserviceWorker } from "./appservice/worker";
import * as yaml from "js-yaml";
import * as fs from "fs";
import { NewRoomHandlerWorker } from "./room_handler/worker";
import { NewLinkerWorker } from "./linker/worker";

LogService.setLogger(new RichConsoleLogger());
LogService.info("index", "Starting Voyager");

program
    .version("2.0.0") // TODO: Make this dynamic
    .option('-w, --worker [name]', 'The worker to run')
    .option('-g, --generate-registration <file_name>', 'Generate a registration file from the configuration. Does not start a worker.')
    .option('-p, --port <port>', 'The port to run the worker on', 0)
    .parse(process.argv);

if (program.generateRegistration) {
    LogService.info("index", "Generating registration file...");
    const registration = AppserviceWorker.generateRegistrationFromConfig("voyager", "example.org");
    const result = yaml.safeDump(registration);
    fs.writeFileSync(program.generateRegistration, result);
    LogService.info("index", "Registration file written! Please verify the file before assuming it is valid.");
    process.exit(0);
}

const knownWorkers: { [name: string]: IWorkerFactory } = {
    appservice: NewAppserviceWorker,
    room_handler: NewRoomHandlerWorker,
    linker: NewLinkerWorker,
};

if (!(program.worker in knownWorkers)) {
    LogService.error("index", "Worker not found");
    process.exit(1);
}

if (program.port > 1) {
    LogService.info("index", `Using port from command line: ${program.port}`);
    VoyagerConfig.web.port = program.port;
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
