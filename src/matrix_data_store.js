var VoyagerMatrixStore = require("./storage/VoyagerMatrixStore");
var LocalStorage = require("node-localstorage").LocalStorage;

var localStorage = new LocalStorage("db/voyager_local_storage", 100 * 1024 * 1024); // quota is 100mb
var store = new VoyagerMatrixStore(localStorage);

module.exports = store;