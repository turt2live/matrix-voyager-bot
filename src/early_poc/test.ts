import * as yaml from "js-yaml";
import * as fs from "fs";
import * as amqp from "amqplib";
import * as randomString from "random-string";
import { TOPIC_ROOM_STATE, TYPE_STATE_EVENT } from "../mq/consts";

const TOPICS = [TOPIC_ROOM_STATE];
const SUPPORTED_TYPES = [TYPE_STATE_EVENT];

/*
rabbitmq:
  proto: amqp
  host: localhost
  port: 5672
  user: voyager
  pass: passw0rd
  vhost: "/voyager"
  exchange: "ex"
*/
const config = yaml.safeLoad(fs.readFileSync("config/worker-test.yaml", "utf8"));
const rmq = config.rabbitmq;

const queueName = randomString({ length: 64 });

(async function () {
    console.log(`Connecting to ${rmq.host}:${rmq.port}...`);
    const connection = await amqp.connect(`${rmq.proto}://${rmq.user}:${rmq.pass}@${rmq.host}:${rmq.port}/${encodeURIComponent(rmq.vhost)}`);

    console.log("Creating channel...");
    const channel = await connection.createChannel();

    console.log(`Asserting queue ${queueName} exists...`);
    const queue = await channel.assertQueue(queueName, { exclusive: true, autoDelete: true });

    console.log(`Asserting exchange ${rmq.exchange} exists...`);
    const exchange = await channel.assertExchange(rmq.exchange, 'topic', { durable: true });

    for (const topic of TOPICS) {
        console.log(`Binding queue for topic ${topic}...`);
        await channel.bindQueue(queueName, rmq.exchange, topic);
    }

    console.log("Waiting for events...");
    await channel.consume(queueName, async (message) => {
        try {
            if (message === null) {
                console.warn("Received null message - ignoring.");
                return;
            }
            if (!message.properties) {
                console.warn("No properties on message - ignoring");
                return;
            }
            if (message.properties.contentType !== "application/json") {
                console.warn("Received non-JSON message - ignoring");
                return;
            }
            if (message.properties.contentEncoding !== "utf8") {
                console.warn("Received non-UTF8 message - ignoring");
                return;
            }
            if (SUPPORTED_TYPES.indexOf(message.properties.type) === -1) {
                console.warn("Unsupported type received - ignoring");
                return;
            }

            const messageType = message.properties.type;

            let content;
            try {
                content = JSON.parse(message.content.toString());
            } catch (e) {
                console.error("Error parsing message content");
                return;
            }

            console.log(`Processing ${messageType} message...`);
            if (messageType === TYPE_STATE_EVENT) {
                if (!content["roomId"] || !content["event"]) {
                    console.error("Received state event update without a roomId or event");
                    return;
                }
                processStateEvent(content["roomId"], content["event"]);
            }

            console.log("Acknowledging message...");
            await channel.ack(message);

            console.log("Done processing message");
        } catch (e) {
            console.error(e);
        }
    }, {});
})().catch(err => {
    console.error(err);
    process.exit(1);
});

function processStateEvent(roomId, event) {
    console.log(`Processing state event in room ${roomId}: `, event);
}
