/**
 * Represents a Voyager worker. A worker performs some amount of work to run
 * the bot, such as serving the web app or calculating a room's publicity status.
 */
export interface IWorker {
    /**
     * Starts the worker.
     * @returns {Promise<*>} resolves when the worker has been started
     */
    start(): Promise<any>;
}

/**
 * Factory for a worker
 */
export interface IWorkerFactory {
    (): IWorker;
}