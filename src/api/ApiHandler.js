var express = require("express");
var log = require("npmlog");
var config = require("config");

/**
 * Processes and controls API requests
 */
class ApiHandler {

    /**
     * Creates a new API handler
     * @param {VoyagerStore} store the store to use
     */
    constructor(store) {
        this._store = store;

        this._app = express();
        this._app.use(express.static('web-dist'));

        this._app.get('/api/v1/network', this._getNetwork.bind(this));
        this._app.get('/api/v1/nodes', this._getNodes.bind(this));
        //this._app.get('/api/v1/nodes/:id', this._getNode.bind(this));
        //this._app.get('/api/v1/events', this._getEvents.bind(this));
    }

    start() {
        this._app.listen(config.get('web.port'), config.get('web.address'));
        log.info("ApiHandler", "API Listening on " + config.get("web.address") + ":" + config.get("web.port"));
    }

    _getNetwork(request, response) {
        var limit = Math.max(0, Math.max(10000, request.query.limit || 1000));
        var since = Math.max(0, request.query.since || 0);

        var handledNodeIds = [];
        var nodes = [];
        var links = [];
        var remaining = 0;

        this._store.getTimelineEventsPaginated(since, limit).then(dto => {
            remaining = dto.remaining;

            for (var event of dto.events) {
                if (handledNodeIds.indexOf(event.sourceNode.id) === -1) {
                    nodes.push(this._nodeToJsonObject(event.sourceNode, event.sourceNodeMeta));
                    handledNodeIds.push(event.sourceNode.id);
                }
                if (handledNodeIds.indexOf(event.targetNode.id) === -1) {
                    nodes.push(this._nodeToJsonObject(event.targetNode, event.targetNodeMeta));
                    handledNodeIds.push(event.targetNode.id);
                }

                links.push(this._linkToJsonObject(event.link));
            }

            var payload = {
                total: links.length,
                remaining: remaining,
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

    _nodeToJsonObject(node, meta) {
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
            if (meta.displayName !== null) obj.meta.displayName = meta.displayName;
            if (meta.avatarUrl !== null) obj.meta.avatarUrl = meta.avatarUrl;
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