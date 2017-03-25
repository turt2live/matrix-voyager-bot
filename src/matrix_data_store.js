var LocalStorage = require("node-localstorage").LocalStorage;
var MatrixInMemoryStore = require("matrix-js-sdk").MatrixInMemoryStore;

var localStorage = new LocalStorage("db/localstorage");
var store = new MatrixInMemoryStore({localStorage: localStorage});
module.exports = store;