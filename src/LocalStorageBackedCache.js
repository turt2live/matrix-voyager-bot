class LocalStorageBackedCache {
    constructor(localStorage) {
        this._storage = localStorage;
        this._cache = {};
    }

    get length() {
        return this._storage.length;
    }

    key(n) {
        return this._storage.key(n);
    }

    getItem(key) {
        var cachedValue = this._cache[key];
        if (cachedValue) return cachedValue;

        this._cache[key] = this._storage.getItem(key);
        return this._cache[key];
    }

    setItem(key, value) {
        this._storage.setItem(key, value);
        this._cache[key] = null;
    }

    removeItem(key) {
        this._storage.removeItem(key);
        this._cache[key] = null;
    }

    clear() {
        this._storage.clear();
        this._cache = {};
    }
}

module.exports = LocalStorageBackedCache;