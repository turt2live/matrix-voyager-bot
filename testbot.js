var MatrixClientLite = require("./src/matrix/MatrixClientLite");
var config = require('config');
var fs = require('fs');

try {
    fs.unlinkSync("db/mtx_client_lite_localstorage/m.synctoken");
} catch (e) {
}

var client = new MatrixClientLite(config.matrix.homeserverUrl, config.matrix.accessToken, config.matrix.userId);

client.on('room_leave', (roomId, event) => console.log("Leave room " + roomId + " due to " + event['sender'] + " because " + JSON.stringify(event['content'])));
client.on('room_invite', (roomId, event) => console.log("Invite to room " + roomId + " from " + event['sender']));
client.on('room_join', roomId => console.log("Joined room " + roomId));
client.on('room_message', (roomId, event) => console.log("Message in room " + roomId + ": " + JSON.stringify(event)));

client.on('room_invite', (roomId, event) => {
    client.joinRoom(roomId).then(() => {
        client.sendNotice(roomId, "Hello world");
    });
});

// client.joinRoom("#test-bot:matrix.org").then(roomId => {
//     return client.sendNotice(roomId, "Hello world :D");
// }).then(() => client.leaveRoom("!ewOgZEUrOZAAaQJNBv:matrix.org"));

client.getRoomState("!ewOgZEUrOZAAaQJNBv:matrix.org");

client.start();