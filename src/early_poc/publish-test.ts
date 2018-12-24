import * as yaml from "js-yaml";
import * as fs from "fs";
import * as amqp from "amqplib";
import { TOPIC_ROOM_STATE, TYPE_STATE_EVENT } from "../mq/consts";

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

const eventBuffer = Buffer.from(JSON.stringify({
    roomId: "!somewhere:example.org",
    event: {
        type: "m.room.name",
        stateKey: "",
        content: {
            name: "Sample Room",
        },
    },
}));

(async function () {
    console.log(`Connecting to ${rmq.host}:${rmq.port}...`);
    const connection = await amqp.connect(`${rmq.proto}://${rmq.user}:${rmq.pass}@${rmq.host}:${rmq.port}/${encodeURIComponent(rmq.vhost)}`);

    console.log("Creating channel...");
    const channel = await connection.createChannel();

    console.log(`Asserting exchange ${rmq.exchange} exists...`);
    const exchange = await channel.assertExchange(rmq.exchange, 'topic', { durable: true });

    console.log("Sending sample payload...");
    const sent = await channel.publish(rmq.exchange, TOPIC_ROOM_STATE, eventBuffer, {
        persistent: true,
        contentType: "application/json",
        contentEncoding: "utf8",
        type: TYPE_STATE_EVENT,
    });

    console.log(`Message sent? ${sent}`);

    console.log("Closing channel...");
    await channel.close();

    console.log("Closing connection...");
    await connection.close();

    console.log("Done. Exiting.");
    process.exit(0);
})().catch(err => {
    console.error(err);
    process.exit(1);
});
