var express = require("express");
var log = require("./../LogService");
var config = require("config");
var moment = require('moment');

const USE_SAMPLE = false;
const STATS_CACHE_TIME_MS = 1 * 60 * 60 * 1000; // 1 hour

/**
 * Processes and controls API requests
 */
class ApiHandler {

    /**
     * Creates a new API handler
     * @param {VoyagerStore} store the store to use
     * @param {VoyagerBot} bot the bot to use
     */
    constructor(store, bot) {
        this._store = store;
        this._bot = bot;
        this._lastStats = null;

        this._app = express();
        this._app.use(express.static('web-dist'));

        this._app.get('/api/v1/network', this._getNetwork.bind(this));
        this._app.get('/api/v1/nodes', this._getNodes.bind(this));
        this._app.get('/api/v1/nodes/publicRooms', this._getPublicRooms.bind(this));
        this._app.get('/api/v1/nodes/:id', this._getNode.bind(this));
        this._app.get('/api/v1/events', this._getEvents.bind(this));
        this._app.get('/api/v1/stats', this._getStats.bind(this));
    }

    start() {
        this._app.listen(config.get('web.port'), config.get('web.address'));
        log.info("ApiHandler", "API Listening on " + config.get("web.address") + ":" + config.get("web.port"));
    }

    _getStats(request, response) {
        if (this._lastStats) {
            var msDiff = moment().valueOf() - this._lastStats.updated;
            if (msDiff < STATS_CACHE_TIME_MS) {
                response.setHeader("Content-Type", "application/json");
                response.send(JSON.stringify(this._lastStats));
                return;
            }
        }

        log.info("ApiHandler", "Stats expired. Getting updated stats to cache...");
        this._store.getBasicStats().then(stats => {
            log.info("ApiHandler", "Got updated stats. " + JSON.stringify(stats));
            stats.updated = moment().valueOf();
            this._lastStats = stats;
            response.setHeader("Content-Type", "application/json");
            response.send(JSON.stringify(this._lastStats));
        }).catch(err => {
            log.error("ApiHandler", err);
            response.sendStatus(500);
        });
    }

    _getNetwork(request, response) {
        if (USE_SAMPLE) {
            var json = require("./network_sample.json");
            response.setHeader("Content-Type", "application/json");
            response.send(JSON.stringify(json));
            return;
        }

        var limit = Math.max(0, Math.min(10000, request.query.limit || 1000));
        var since = Math.max(0, request.query.since || 0);

        var handledNodeIds = [];
        var nodes = [];
        var links = [];
        var remaining = 0;
        var redactedLinks = 0;
        var hiddenLinks = 0;

        log.info("ApiHandler", "Getting events for query since=" + since + " limit=" + limit);
        this._store.getTimelineEventsPaginated(since, limit).then(dto => {
            log.info("ApiHandler", "Got " + dto.events.length + " events (" + dto.remaining + " remaining) for query since=" + since + " limit=" + limit);

            remaining = dto.remaining;

            var bannedRooms = [];

            for (var event of dto.events) {
                if (event.link.type != 'kick' && event.link.type != 'ban') continue;

                bannedRooms.push(event.targetNode.id);
            }

            for (var event of dto.events) {
                if (event.link.isRedacted || bannedRooms.indexOf(event.sourceNode.id) !== -1 || bannedRooms.indexOf(event.targetNode.id) !== -1) {
                    redactedLinks++;
                    continue;
                }

                if (!event.link.isVisible) {
                    hiddenLinks++;
                    continue;
                }

                if (handledNodeIds.indexOf(event.sourceNode.id) === -1) {
                    nodes.push(this._nodeToJsonObject(event.sourceNode, event.sourceNodeMeta));
                    handledNodeIds.push(event.sourceNode.id);
                }
                if (handledNodeIds.indexOf(event.targetNode.id) === -1) {
                    nodes.push(this._nodeToJsonObject(event.targetNode, event.targetNodeMeta));
                    handledNodeIds.push(event.targetNode.id);
                }

                if (!event.targetNode.isRedacted && !event.sourceNode.isRedacted)
                    links.push(this._linkToJsonObject(event.link));
            }

            var payload = {
                total: links.length,
                remaining: remaining,
                redacted: redactedLinks,
                hidden: hiddenLinks,
                results: {
                    nodes: nodes,
                    links: links
                }
            };
            response.setHeader("Content-Type", "application/json");
            response.send(JSON.stringify(payload));
        }, err => {
            log.error("ApiHandler", err);
            response.sendStatus(500);
        }).catch(err => {
            log.error("ApiHandler", err);
            response.sendStatus(500);
        });
    }

    _getNodes(request, response) {
        this._store.getAllNodes().then(nodes => {
            var payload = nodes.map(r => this._nodeToJsonObject(r, r.currentMeta));
            response.setHeader("Content-Type", "application/json");
            response.send(JSON.stringify(payload));
        }, err => {
            log.error("ApiHandler", err);
            response.sendStatus(500);
        }).catch(err => {
            log.error("ApiHandler", err);
            response.sendStatus(500);
        });
    }

    _getPublicRooms(request, response) {
        this._store.getPublicRooms().then(nodes => {
            var promise = Promise.resolve();
            var mapped = nodes.map(r => this._nodeToJsonObject(r, r.currentMeta));
            // mapped = mapped.map(r => {
            //     promise = promise
            //         .then(() => this._bot.getRoomStats(r.meta.objectId))
            //         .then(stats => r.meta.stats = stats);
            //     return r;
            // });

            promise.then(() => {
                response.setHeader("Content-Type", "application/json");
                response.send(JSON.stringify(mapped));
            });
        }).catch(err => {
            log.error("ApiHandler", err);
            response.sendStatus(500);
        });
    }

    _getNode(request, response) {
        this._store.getNodeById(request.params.id).then(node => {
            if (!node) {
                response.setHeader("Content-Type", "application/json");
                response.status(404);
                response.send("{}");
            } else {
                this._store.getCurrentNodeState(node).then(meta => {
                    var payload = this._nodeToJsonObject(node, meta);
                    response.setHeader("Content-Type", "application/json");
                    response.send(JSON.stringify(payload));
                }, err => {
                    log.error("ApiHandler", err);
                    response.sendStatus(500);
                });
            }
        }, err => {
            log.error("ApiHandler", err);
            response.sendStatus(500);
        }).catch(err => {
            log.error("ApiHandler", err);
            response.sendStatus(500);
        });
    }

    _getEvents(request, response) {
        var limit = Math.max(0, Math.min(10000, request.query.limit || 1000));
        var since = Math.max(0, request.query.since || 0);

        var events = [];
        var remaining = 0;

        this._store.getStateEventsPaginated(since, limit).then(dto => {
            remaining = dto.remaining;

            for (var event of dto.events) {
                var obj = {
                    id: event.stateEvent.id,
                    type: event.stateEvent.type,
                    timestamp: event.stateEvent.timestamp,
                    meta: null
                };

                if (event.node && event.nodeVersion) {
                    obj.nodeId = event.node.id;
                    obj.nodeVersionId = event.nodeVersion.id;

                    var tempMeta = this._nodeToJsonObject(event.node, event.nodeVersion, true);
                    obj.meta = tempMeta.meta;
                }

                if (event.link) {
                    obj.linkId = event.link.id;

                    var tempMeta = this._linkToJsonObject(event.link);
                    obj.meta = tempMeta.meta;
                }

                events.push(obj);
            }

            var payload = {
                total: events.length,
                remaining: remaining,
                results: {
                    events: events
                }
            };
            response.setHeader("Content-Type", "application/json");
            response.send(JSON.stringify(payload));
        }, err => {
            log.error("ApiHandler", err);
            response.sendStatus(500);
        }).catch(err => {
            log.error("ApiHandler", err);
            response.sendStatus(500);
        });
    }

    _nodeToJsonObject(node, meta, allowEmptyStrings = false) {
        var obj = {
            id: node.id,
            firstIntroduced: node.firstTimestamp,
            meta: {
                type: node.type,
                isAnonymous: meta.isAnonymous === null ? true : meta.isAnonymous
            }
        };

        if (!obj.meta.isAnonymous) {
            obj.meta.objectId = node.objectId;
            if (meta.displayName !== null && (meta.displayName !== '' && !allowEmptyStrings)) obj.meta.displayName = meta.displayName;
            if (meta.avatarUrl !== null && (meta.avatarUrl !== '' && !allowEmptyStrings)) obj.meta.avatarUrl = meta.avatarUrl;
            if (meta.primaryAlias !== null && (meta.primaryAlias !== '' && !allowEmptyStrings)) obj.meta.primaryAlias = meta.primaryAlias;
        }

        return obj;
    }

    _linkToJsonObject(link) {
        var obj = {
            id: link.id,
            timestamp: link.timestamp,
            meta: {
                sourceNodeId: link.sourceNodeId,
                targetNodeId: link.targetNodeId,
                type: link.type
            }
        };

        return obj;
    }
}

module.exports = ApiHandler;