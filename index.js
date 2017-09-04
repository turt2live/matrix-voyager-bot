var VoyagerBot = require("./src/VoyagerBot");
var VoyagerStore = require("./src/storage/VoyagerStore");
var ApiHandler = require("./src/api/ApiHandler");
var log = require("./src/LogService");

log.info("index", "Bootstrapping bot");
var db = new VoyagerStore();
db.prepare().then(() => {
    var bot = new VoyagerBot(db);
    bot.start();

    var api = new ApiHandler(db, bot);
    api.start();
});
