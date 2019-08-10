import { LogService } from "matrix-bot-sdk";
import { VoyagerConfig } from "../VoyagerConfig";
import * as amqp from "amqplib";
import * as randomString from "random-string";

export class MqConnection {

    private channel: any;
    private listeners: { [topic: string]: ((type: string, payload: any) => any | void)[] } = {};
    private queueName: string = randomString({length: 64});
    private boundTopics: string[] = [];

    constructor() {
    }

    public async start(): Promise<any> {
        const hostname = `${VoyagerConfig.rabbitmq.host}:${VoyagerConfig.rabbitmq.port}`;
        LogService.info("mq", `Connecting to ${hostname}...`);

        const identity = `${VoyagerConfig.rabbitmq.user}:${VoyagerConfig.rabbitmq.password}`;
        const connection = await amqp.connect(`${VoyagerConfig.rabbitmq.protocol}://${identity}@${hostname}/${encodeURIComponent(VoyagerConfig.rabbitmq.vhost)}`);

        LogService.info("mq", "Creating channel...");
        this.channel = await connection.createChannel();

        LogService.info("mq", `Asserting dead letter exchange ${VoyagerConfig.rabbitmq.deadLetterExchange} exists...`);
        await this.channel.assertExchange(VoyagerConfig.rabbitmq.deadLetterExchange, "fanout", {durable: true});

        LogService.info("mq", `Asserting exchange ${VoyagerConfig.rabbitmq.exchange} exists...`);
        await this.channel.assertExchange(VoyagerConfig.rabbitmq.exchange, "topic", {
            durable: true,
            alternateExchange: VoyagerConfig.rabbitmq.deadLetterExchange,
        });

        LogService.info("mq", `Asserting queue ${this.queueName} exists...`);
        await this.channel.assertQueue(this.queueName, {
            exclusive: true,
            autoDelete: true,
            deadLetterExchange: VoyagerConfig.rabbitmq.deadLetterExchange,
        });
        for (const topic of Object.keys(this.listeners)) await this.doBind(topic);

        LogService.info("mq", `Asserting dead letter queue ${VoyagerConfig.rabbitmq.deadLetterQueue} exists...`);
        await this.channel.assertQueue(VoyagerConfig.rabbitmq.deadLetterQueue, {
            durable: true,
            messageTtl: 2 * 60 * 1000, // 2 minutes
            deadLetterExchange: VoyagerConfig.rabbitmq.exchange,
        });

        LogService.info("mq", "Binding dead letter exchange to dead letter queue...");
        await this.channel.bindQueue(VoyagerConfig.rabbitmq.deadLetterQueue, VoyagerConfig.rabbitmq.deadLetterExchange, "*");

        LogService.info("mq", "Listening for events...");
        await this.channel.consume(this.queueName, this.onMessage.bind(this));

        LogService.info("mq", "RabbitMQ ready");
    }

    private async doBind(topic: string) {
        if (this.boundTopics.indexOf(topic) !== -1) return;
        LogService.info("mq", `Binding topic ${topic} on ${VoyagerConfig.rabbitmq.exchange} to queue ${this.queueName}...`);
        await this.channel.bindQueue(this.queueName, VoyagerConfig.rabbitmq.exchange, topic);
        this.boundTopics.push(topic);
    }

    /**
     * Sends a payload to the exchange
     * @param {string} topic The topic to tag the payload as
     * @param {string} type The type of payload being sent
     * @param {*} payload The payload to send
     * @returns {Promise<boolean>} resolves to whether or not the payload was sent
     */
    public async sendPayload(topic: string, type: string, payload: any): Promise<boolean> {
        LogService.info("mq", `Sending payload to topic ${topic} of type ${type}`);
        const buf = Buffer.from(JSON.stringify(payload));
        return this.channel.publish(VoyagerConfig.rabbitmq.exchange, topic, buf, {
            persistent: true,
            contentType: "application/json",
            contentEncoding: "utf8",
            type: type,
        });
    }

    /**
     * Creates an event handler for a given topic
     * @param {string} topic The topic to listen for
     * @param {Function} fn The event handler
     * @returns {Promise<*>} resolves when registered
     */
    public async on(topic: string, fn: (type: string, payload: any) => any | void) {
        if (!this.listeners[topic]) this.listeners[topic] = [];
        this.listeners[topic].push(fn);

        if (this.channel) await this.doBind(topic);
    }

    private async onMessage(message: any): Promise<any> {
        try {
            if (!message) return;
            if (!message.properties) {
                LogService.warn("mq#onMessage", "Received message without properties - ignoring");
                return;
            }
            if (message.properties.contentType !== "application/json") {
                LogService.warn("mq#onMessage", "Received non-JSON message - ignoring");
                return;
            }
            if (message.properties.contentEncoding !== "utf8") {
                LogService.warn("mq#onMessage", "Received non-UTF8 message - ignoring");
                return;
            }
            if (!message.fields || !this.listeners[message.fields.routingKey]) {
                LogService.warn("mq#onMessage", "Received unexpected routing key - ignoring");
                return;
            }

            LogService.info("mq#onMessage", `Delivering ${message.properties.type} message from ${message.fields.routingKey} to ${this.listeners[message.fields.routingKey].length} handlers...`);
            const payload = JSON.parse(message.content.toString());
            for (const handler of this.listeners[message.fields.routingKey]) {
                handler(message.properties.type, payload);
            }

            LogService.info("mq#onMessage", "Acknowledging message...");
            await this.channel.ack(message);
            LogService.info("mq#onMessage", "Acknowledged.");
        } catch (e) {
            LogService.error("mq#onMessage", e);
        }
    }
}