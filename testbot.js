var MatrixClientLite = require("./src/matrix/MatrixClientLite");
var config = require('config');

var client = new MatrixClientLite(config.matrix.homeserverUrl, config.matrix.accessToken, config.matrix.userId);
client.start();