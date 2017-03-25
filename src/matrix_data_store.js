var LocalStorage = require("node-localstorage").LocalStorage;

var WebStorageStore = require("matrix-js-sdk/lib/store/webstorage");
var MatrixInMemoryStore = require("matrix-js-sdk").MatrixInMemoryStore;

var localStorage = new LocalStorage("db/localstorage", 100 * 1024 * 1024); // quota is 100mb

var store = new WebStorageStore(localStorage, 25);
var memoryStore = new MatrixInMemoryStore({localStorage: localStorage});

// We use some functions from the memory store because the WebStorageStore doesn't support them

store.getFilter = function (userId, filterId) {
    return memoryStore.getFilter(userId, filterId);
};

store.storeFilter = function (filter) {
    memoryStore.storeFilter(filter);
};

store.getFilterIdByName = function (filterName) {
    return memoryStore.getFilterIdByName(filterName);
};

store.setFilterIdByName = function (filterName, filterId) {
    memoryStore.setFilterIdByName(filterName, filterId);
};

store.storeAccountDataEvents = function (events) {
    memoryStore.storeAccountDataEvents(events);
};

store.getAccountData = function (eventType) {
    return memoryStore.getAccountData(eventType);
};

module.exports = store;