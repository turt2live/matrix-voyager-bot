var MatrixHandler = require("./src/MatrixHandler");
var WebHandler = require("./src/WebHandler");
var DataStore = require("./src/DataStore");
var log = require("npmlog");

log.info("index", "Preparing database");

var db = new DataStore();
db.prepare().then(() => {
    var matrix = new MatrixHandler(db);
    matrix.listen();

    var web = new WebHandler(db, matrix);
    web.listen();
});