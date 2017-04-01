var VoyagerBot = require("./src/VoyagerBot");
var VoyagerStore = require("./src/storage/VoyagerStore");
var log = require("npmlog");

log.info("index", "Bootstrapping bot");
var db = new VoyagerStore();
db.prepare().then(() => {
    var bot = new VoyagerBot(db);
    bot.start();

    // TODO: Start web
});
