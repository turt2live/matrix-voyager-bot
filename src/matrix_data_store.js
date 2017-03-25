var LocalStorage = require("node-localstorage").LocalStorage;
var MatrixInMemoryStore = require("matrix-js-sdk").MatrixInMemoryStore;

var localStorage = new LocalStorage("db/localstorage");
var store = new MatrixInMemoryStore(localStorage);

// override sync token functions
store.setSyncToken = function (token) {
    localStorage.setItem("voyager-sync-token", token);
};

store.getSyncToken = function () {
    return localStorage.getItem("voyager-sync-token");
};

module.exports = store;