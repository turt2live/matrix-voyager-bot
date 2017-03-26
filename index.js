var MatrixHandler = require("./src-old/MatrixHandler");
var WebHandler = require("./src-old/WebHandler");
var DataStore = require("./src-old/DataStore");
var log = require("npmlog");

log.info("index", "Preparing database");

var db = new DataStore();
db.prepare().then(() => {
    var matrix = new MatrixHandler(db);
    matrix.listen();

    var web = new WebHandler(db, matrix);
    web.listen();
});