var sqlite3 = require('sqlite3');
var DBMigrate = require("db-migrate");
var log = require("npmlog");

/**
 * Primary storage for Voyager.
 */
class VoyagerStore {

    constructor() {
        this._db = null;
        this._enrolledIds = [];
    }

    /**
     * Prepares the store for use
     */
    prepare() {
        log.info("VoyagerStore", "Running migrations");
        return new Promise((resolve, reject)=> {
            var dbMigrate = DBMigrate.getInstance(true, {
                config: "./config/database.json",
                env: process.env.NODE_ENV || "development"
            });
            dbMigrate.up().then(() => {
                this._db = new sqlite3.Database("./db/" + (process.env.NODE_ENV || "development") + ".db");
                this._populateEnrolledUsers().then(resolve, reject);
            }, err => {
                log.error("VoyagerStore", err);
                reject(err);
            }).catch(err => {
                log.error("VoyagerStore", err);
                reject(err);
            });
        });
    }

    _populateEnrolledUsers() {
        return new Promise((resolve, reject) => {
            this._db.all("SELECT objectId FROM nodes WHERE type = 'user' AND (SELECT isAnonymous FROM node_versions WHERE node_versions.nodeId = nodes.id AND isAnonymous IS NOT NULL ORDER BY id DESC LIMIT 1) = 0", (err, rows)=> {
                if (err) {
                    log.error("VoyagerStore", "Could not get enrolled users");
                    log.error("VoyagerStore", err);
                    reject(err);
                    return;
                }
                if (!rows) return;

                for (var row of rows) {
                    this._enrolledIds.push(row.objectId);
                }

                log.info("VoyagerStore", "Populated enrolled users. Found " + this._enrolledIds.length + " users enrolled");
                resolve();
            });
        });
    }

    /**
     * Creates a new state event
     * @param {'node_added'|'node_removed'|'node_updated'|'link_added'|'link_removed'} type the type of event
     * @param {{nodeId: Number, nodeVersionId: Number}|{linkId: Number}} params the params for the event, must match the event type
     * @returns {Promise<StateEvent>} resolves to the created state event
     */
    createStateEvent(type, params) {
        return new Promise((resolve, reject) => {
            var self = this;
            var handler = function (err) {
                if (err)reject(err);
                else self.getStateEvent(this.lastID).then(resolve, reject);
            };

            switch (type) {
                case 'link_added':
                case 'link_removed':
                    this._db.run("INSERT INTO state_events (type, linkId, timestamp) VALUES (?, ?, CURRENT_TIMESTAMP)",
                        type, params.linkId, handler);
                    break;
                case 'node_added':
                case 'node_removed':
                case 'node_updated':
                    this._db.run("INSERT INTO state_events (type, nodeId, nodeVersionId, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                        type, params.nodeId, params.nodeVersionId, handler);
                    break;
                default:
                    reject(new Error("State event type not known: " + type));
                    break;
            }
        });
    }

    /**
     * Gets a state event from the data store
     * @param {Number} id the event ID
     * @returns {Promise<StateEvent>} resolves to the state event, or null if not found
     */
    getStateEvent(id) {
        return new Promise((resolve, reject) => {
            this._db.get("SELECT * FROM state_events WHERE id = ?", id, (err, row) => {
                if (err)reject(err);
                else {
                    if (row) resolve(new StateEvent(row));
                    else resolve(null);
                }
            });
        });
    }

    /**
     * Creates a new Node
     * @param {'user'|'room'} type the type of Node
     * @param {string} objectId the object ID for the Node
     * @param {{displayName: String, avatarUrl: String, isAnonymous: boolean}} firstVersion the first version of the Node
     * @param {boolean} isReal true if the node is a real node
     * @param {boolean} isRedacted true if the node should be redacted
     * @return {Promise<Node>} resolves to the created Node
     */
    createNode(type, objectId, firstVersion, isReal = true, isRedacted = false) {
        return new Promise((resolve, reject)=> {
            var self = this;
            this._db.run("INSERT INTO nodes (type, objectId, isReal, firstTimestamp, isRedacted) VALUES (?, ?, ?, ?, ?)",
                type, objectId, isReal, 0, isRedacted, function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    var nodeId = this.lastID;

                    self._db.run("INSERT INTO node_versions (nodeId, displayName, avatarUrl, isAnonymous) VALUES (?, ?, ?, ?)",
                        nodeId, firstVersion.displayName, firstVersion.avatarUrl, firstVersion.isAnonymous, function (err) {
                            if (err) {
                                reject(err);
                                return
                            }
                            var nodeVersionId = this.lastID;

                            self.createStateEvent('node_added', {
                                nodeId: nodeId,
                                nodeVersionId: nodeVersionId
                            }).then(() => self.getNodeById(nodeId)).then(resolve, reject);
                        });
                });
        });
    }

    /**
     * Gets a Node from the data store
     * @param {Number} id the ID of the node
     * @returns {Promise<Node>} resolves to the found node, or null if not found
     */
    getNodeById(id) {
        return new Promise((resolve, reject) => {
            this._db.get("SELECT * FROM nodes WHERE id = ?", id, (err, row) => {
                if (err) reject(err);
                else {
                    if (row) resolve(new Node(row));
                    else resolve(null);
                }
            });
        });
    }

    /**
     * Gets a Node from the data store
     * @param {'user'|'room} type the type of Node
     * @param {string} objectId the object ID of the Node
     * @returns {Promise<Node>} resolves to the found node, or null if not found
     */
    getNode(type, objectId) {
        return new Promise((resolve, reject) => {
            this._db.get("SELECT * FROM nodes WHERE type = ? AND objectId = ? LIMIT 1",
                type, objectId, (err, row) => {
                    if (err) reject(err);
                    else {
                        if (row) resolve(new Node(row));
                        else resolve(null);
                    }
                });
        });
    }

    /**
     * Gets whether or not the given user has enrolled into being public
     * @param {string} userId the user ID to lookup
     * @returns {boolean} true if enrolled, false otherwise
     */
    isEnrolled(userId) {
        return this._enrolledIds.indexOf(userId) !== -1;
    }

    /**
     * Sets whether or not the given user is enrolled in being public
     * @param {string} userId the user ID to update
     * @param {boolean} isEnrolled true to enroll, false otherwise
     * @returns {Promise} resolved when complete
     */
    setEnrolled(userId, isEnrolled) {
        return new Promise((resolve, reject) => {
            this.getNode('user', userId).then(node => {
                if (!node) reject(new Error("User node not found for user " + userId));
                else return this.createNodeVersion(node, {isAnonymous: !isEnrolled})
            }).then(()=> {
                var idx = this._enrolledIds.indexOf(userId);
                if (isEnrolled && idx === -1)
                    this._enrolledIds.push(userId);
                else if (!isEnrolled && idx !== -1)
                    this._enrolledIds.splice(idx, 1);
                resolve();
            });
        });
    }

    /**
     * Creates a new node version
     * @param {Node} node the node to append a version to
     * @param {{displayName: String?, avatarUrl: String?, isAnonymous: boolean?}} fields the fields to update
     * @returns {Promise<NodeVersion>} resolves with the created node version
     */
    createNodeVersion(node, fields) {
        return new Promise((resolve, reject) => {
            var self = this;
            this._db.run("INSERT INTO node_versions (nodeId, displayName, avatarUrl, isAnonymous) VALUES (?, ?, ?, ?)",
                node.id, valOrDBNull(fields.displayName), valOrDBNull(fields.avatarUrl), valOrDBNull(fields.isAnonymous), function (err) {
                    var nodeVersionId = this.lastID;
                    if (err) reject(err);
                    else {
                        self.createStateEvent('node_updated', {
                            nodeId: node.id,
                            nodeVersionId: nodeVersionId
                        }).then(() => {
                            self.getNodeVersionById(nodeVersionId).then(resolve, reject);
                        }, reject);
                    }
                });
        });
    }

    /**
     * Gets a node version from the data store
     * @param {Number} id the node version ID to look up
     * @returns {Promise<NodeVersion>} resolves to a node version, or null if not found
     */
    getNodeVersionById(id) {
        return new Promise((resolve, reject) => {
            this._db.get("SELECT * FROM node_versions WHERE id = ?", id, (err, row) => {
                if (err) reject(err);
                else {
                    if (row) resolve(new NodeVersion(row));
                    else resolve(null);
                }
            });
        });
    }

    /**
     * Creates a new Link
     * @param {Node} sourceNode the source Node
     * @param {Node} targetNode the target Node
     * @param {'invite'|'message'|'self_link'|'kick'|'ban'} type the link type
     * @param {number} timestamp the timestamp of the event
     * @param {boolean} isVisible true if the link is visible
     * @param {boolean} isRedacted true if the link should be redacted
     * @returns {Promise<Link>} resolves to the created link
     */
    createLink(sourceNode, targetNode, type, timestamp, isVisible = true, isRedacted = false) {
        var self = this;
        return new Promise((resolve, reject) => {
            this._db.run("INSERT INTO links (type, sourceNodeId, targetNodeId, timestamp, isVisible, isRedacted) VALUES (?, ?, ?, ?, ?, ?)",
                type, sourceNode.id, targetNode.id, timestamp, isVisible, isRedacted, function (err) {
                    var linkId = this.lastID;
                    if (err) reject(err);
                    else self.createStateEvent('link_added', {linkId: linkId}).then(() => {
                        self.getLinkById(linkId).then(resolve, reject);
                    });
                });
        });
    }

    /**
     * Gets a link from the data store
     * @param {Number} id the link ID to look up
     * @returns {Promise<Link>} resolves to the found link, or null if not found
     */
    getLinkById(id) {
        return new Promise((resolve, reject) => {
            this._db.get("SELECT * FROM links WHERE id = ?", id, (err, row) => {
                if (err) reject(err);
                else {
                    if (row) resolve(new Link(row));
                    else resolve(null);
                }
            });
        });
    }

    /**
     * Creates a new TimelineEvent
     * @param {Link} link the link
     * @param {number} timestamp the timestamp of the event
     * @param {string} matrixEventId the Matrix event ID
     * @param {String} message an optional message to associate with the event
     * @returns {Promise<TimelineEvent>} resolves to the created timeline event
     */
    createTimelineEvent(link, timestamp, matrixEventId, message = null) {
        return new Promise((resolve, reject) => {
            var sourceNode;
            var targetNode;

            this.getNodeById(link.sourceNodeId).then(node => {
                sourceNode = node;
                return this.getNodeById(link.targetNodeId);
            }).then(node => {
                targetNode = node;

                return this._updateNodeTimestamp(sourceNode, timestamp);
            }).then(() => {
                return this._updateNodeTimestamp(targetNode, timestamp);
            }).then(() => {
                var self = this;
                this._db.run("INSERT INTO timeline_events (linkId, timestamp, message, matrixEventId) VALUES (?, ?, ?, ?)",
                    link.id, timestamp, message, matrixEventId, function (err) {
                        if (err) reject(err);
                        else self.getTimelineEventById(this.lastID).then(resolve, reject);
                    });
            });
        });
    }

    _updateNodeTimestamp(node, timestamp) {
        return new Promise((resolve, reject) => {
            if (node.firstTimestamp <= timestamp && node.firstTimestamp != 0) resolve();
            else {
                this._db.run("UPDATE nodes SET firstTimestamp = ? WHERE id = ?", timestamp, node.id, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            }
        });
    }

    /**
     * Gets a timeline event from the data store
     * @param {number} id the timeline event ID to lookup
     * @returns {Promise<TimelineEvent>} resolves to the timeline event, or null if not found
     */
    getTimelineEventById(id) {
        return new Promise((resolve, reject) => {
            this._db.get("SELECT * FROM timeline_events WHERE id = ?", id, (err, row) => {
                if (err) reject(err);
                else {
                    if (row) resolve(new TimelineEvent(row));
                    else resolve(null);
                }
            });
        });
    }

    /**
     * Attempts to find a given Link
     * @param {Node} sourceNode the source node
     * @param {Node} targetNode the target node
     * @param {'invite'|'message'|'self_link'|'kick'|'ban'} type the link type
     * @returns {Promise<Link>} resolves with the found link, or null
     */
    findLink(sourceNode, targetNode, type) {
        return new Promise((resolve, reject) => {
            this._db.get("SELECT * FROM links WHERE sourceNodeId = ? AND targetNodeId = ? AND type = ? LIMIT 1",
                sourceNode.id, targetNode.id, type, (err, row) => {
                    if (err) reject(err);
                    else {
                        if (row) resolve(new Link(row));
                        else resolve(null);
                    }
                });
        });
    }

    /**
     * Updates a node to be redacted
     * @param {Node} node the node to be redacted
     * @returns {Promise} resolves when the node has been updated
     */
    redactNode(node) {
        return new Promise((resolve, reject) => {
            this._db.run("UPDATE nodes SET isRedacted = 1 WHERE id = ?", node.id, (err) => {
                if (err) reject(err);
                else {
                    this.getCurrentNodeVersionForNode(node).then(version => {
                        this.createStateEvent('node_removed', {
                            nodeId: node.id,
                            nodeVersionId: version.id
                        }).then(resolve, reject);
                    }, reject);
                }
            });
        });
    }

    /**
     * Gets the current node version for a given node from the data store
     * @param {Node} node the node to look up the version of
     * @returns {Promise<NodeVersion>} resolves to the found node version, or null if none was found
     */
    getCurrentNodeVersionForNode(node) {
        return new Promise((resolve, reject) => {
            this._db.get("SELECT * FROM node_version WHERE nodeId = ? ORDER BY id DESC LIMIT 1", node.id, (err, row) => {
                if (err) reject(err);
                else {
                    if (row) resolve(new NodeVersion(row));
                    else resolve(null);
                }
            });
        });
    }

    /**
     * Updates a link to be redacted
     * @param {Link} link the link to be redacted
     * @returns {Promise} resolves when the link has been updated
     */
    redactLink(link) {
        return new Promise((resolve, reject) => {
            this._db.run("UPDATE links SET isRedacted = 1 WHERE id = ?", link.id, (err) => {
                if (err) reject(err);
                else {
                    this.createStateEvent('link_removed', {linkId: link.id}).then(resolve, reject);
                }
            });
        });
    }

    /**
     * Gets all of the state events for the given range
     * @param {Number} since the timestamp to start the search from, exclusive
     * @param {Number} limit the total number of results to search for
     * @returns {Promise<{remaining: Number, events: CompleteStateEvent[]}>} resolves to information about the results. May be an empty array
     */
    getStateEventsPaginated(since, limit) {
        return new Promise((resolve, reject) => {
            var events = [];
            var remaining = 0;

            // It's more efficient for us to look up all the fields possible in one
            // query because it means we don't need to make 10,000 return trips to the
            // database. However, the sqlite3 library is somewhat limited so we need to
            // do the object mapping ourselves.
            //
            // The queries below get the StateEvent and Link or Node information depending
            // on the event type.

            var linkStateQuery = ""+
                "SELECT  state_events.id AS 'state_events.id',\n" +
                "        state_events.type AS 'state_events.type',\n" +
                "        state_events.linkId AS 'state_events.linkId',\n" +
                "        state_events.nodeId AS 'state_events.nodeId',\n" +
                "        state_events.nodeVersionId AS 'state_events.nodeVersionId',\n" +
                "        state_events.timestamp AS 'state_events.timestamp',\n" +
                "        links.id AS 'links.id',\n" +
                "        links.type AS 'links.type',\n" +
                "        links.sourceNodeId AS 'links.sourceNodeId',\n" +
                "        links.targetNodeId AS 'links.targetNodeId',\n" +
                "        links.timestamp AS 'links.timestamp',\n" +
                "        links.isVisible AS 'links.isVisible',\n" +
                "        links.isRedacted AS 'links.isRedacted'\n" +
                "FROM state_events\n" +
                "JOIN links ON links.id = state_events.linkId\n" +
                "WHERE state_events.timestamp > ?\n" +
                "LIMIT ?";

            var nodeStateQuery = ""+
                "SELECT  state_events.id AS 'state_events.id',\n" +
                "        state_events.type AS 'state_events.type',\n" +
                "        state_events.linkId AS 'state_events.linkId',\n" +
                "        state_events.nodeId AS 'state_events.nodeId',\n" +
                "        state_events.nodeVersionId AS 'state_events.nodeVersionId',\n" +
                "        state_events.timestamp AS 'state_events.timestamp',\n" +
                "        nodes.id AS 'nodes.id',\n" +
                "        nodes.type AS 'nodes.type',\n" +
                "        nodes.objectId AS 'nodes.objectId',\n" +
                "        nodes.isReal AS 'nodes.isReal',\n" +
                "        nodes.firstTimestamp AS 'nodes.firstTimestamp',\n" +
                "        nodes.isRedacted AS 'nodes.isRedacted',\n" +
                "        (SELECT node_versions.displayName FROM node_versions WHERE node_versions.nodeId = state_events.nodeId AND node_versions.displayName IS NOT NULL ORDER BY node_versions.id DESC LIMIT 1) AS 'node_versions.displayName',\n" +
                "        (SELECT node_versions.avatarUrl FROM node_versions WHERE node_versions.nodeId = state_events.nodeId AND node_versions.avatarUrl IS NOT NULL ORDER BY node_versions.id DESC LIMIT 1) AS 'node_versions.avatarUrl',\n" +
                "        (SELECT node_versions.isAnonymous FROM node_versions WHERE node_versions.nodeId = state_events.nodeId AND node_versions.isAnonymous IS NOT NULL ORDER BY node_versions.id DESC LIMIT 1) AS 'node_versions.isAnonymous'\n" +
                "FROM state_events\n" +
                "JOIN nodes ON nodes.id = state_events.nodeId\n" +
                "JOIN node_versions ON node_versions.id = state_events.nodeVersionId\n" +
                "WHERE state_events.timestamp > ?\n" +
                "LIMIT ?";

            this._db.all(linkStateQuery, since, limit, (err, rows) => {
               if(err) {
                   reject(err);
                   return;
               }

                var linkResults = (rows || []).map(r => new CompleteStateEvent(r));

                this._db.all(nodeStateQuery, since, limit, (err, rows) => {
                    if(err) {
                        reject(err);
                        return;
                    }

                    var nodeResults = (rows || []).map(r => new CompleteStateEvent(r));

                    var events = [];
                    for(var evt of linkResults) events.push(evt);
                    for(var evt of nodeResults) events.push(evt);

                    events.sort((a, b) => a.stateEvent.timestamp - b.stateEvent.timestamp); // ascending order

                    // Because we were naughty in our query, we may have ended up with more than the expected number of
                    // results. Because of this, we'll have to manually trim the array.
                    if(events.length > limit) {
                        events = events.splice(0, limit); // splice returns the deleted elements
                    }

                    this._db.get("SELECT COUNT(*) AS total FROM state_events WHERE timestamp > ?", since, (err, row) => {
                        if (err) reject(err);
                        else resolve({
                            remaining: Math.max(0, (row.total || 0) - events.length),
                            events: events
                        });
                    });
                });
            });
        });
    }

    /**
     * Gets all of the timeline events for the given range
     * @param {Number} since the timestamp to start the search from, exclusive
     * @param {Number} limit the total number of results to search for
     * @returns {Promise<{remaining: Number, events: CompleteTimelineEvent[]}>} resolves to information about the results. May be an empty array
     */
    getTimelineEventsPaginated(since, limit) {
        return new Promise((resolve, reject) => {
            var events = [];
            var remaining = 0;

            // It's more efficient for us to look up all the fields possible in one
            // query because it means we don't need to make 10,000 return trips to the
            // database. However, the sqlite3 library is somewhat limited so we need to
            // do the object mapping ourselves.
            //
            // This query gets the TimelineEvent, referenced Link, the source and target Node,
            // as well as the meta information for the Nodes (similar to a NodeVersion).
            var query = "" +
                "SELECT  timeline_events.id AS 'timeline_events.id',\n" +
                "        timeline_events.linkId AS 'timeline_events.linkId',\n" +
                "        timeline_events.timestamp AS 'timeline_events.timestamp',\n" +
                "        timeline_events.message AS 'timeline_events.message',\n" +
                "        timeline_events.matrixEventId AS 'timeline_events.matrixEventId',\n" +
                "        links.id AS 'links.id',\n" +
                "        links.type AS 'links.type',\n" +
                "        links.sourceNodeId AS 'links.sourceNodeId',\n" +
                "        links.targetNodeId AS 'links.targetNodeId',\n" +
                "        links.timestamp AS 'links.timestamp',\n" +
                "        links.isVisible AS 'links.isVisible',\n" +
                "        links.isRedacted AS 'links.isRedacted',\n" +
                "        sourceNode.id AS 'sourceNode.id',\n" +
                "        sourceNode.type AS 'sourceNode.type',\n" +
                "        sourceNode.objectId AS 'sourceNode.objectId',\n" +
                "        sourceNode.isReal AS 'sourceNode.isReal',\n" +
                "        sourceNode.firstTimestamp AS 'sourceNode.firstTimestamp',\n" +
                "        sourceNode.isRedacted AS 'sourceNode.isRedacted',\n" +
                "        (SELECT node_versions.displayName FROM node_versions WHERE node_versions.nodeId = links.sourceNodeId AND node_versions.displayName IS NOT NULL ORDER BY node_versions.id DESC LIMIT 1) as 'sourceNode.nodeVersion.displayName',\n" +
                "        (SELECT node_versions.avatarUrl FROM node_versions WHERE node_versions.nodeId = links.sourceNodeId AND node_versions.avatarUrl IS NOT NULL ORDER BY node_versions.id DESC LIMIT 1) as 'sourceNode.nodeVersion.avatarUrl',\n" +
                "        (SELECT node_versions.isAnonymous FROM node_versions WHERE node_versions.nodeId = links.sourceNodeId AND node_versions.isAnonymous IS NOT NULL ORDER BY node_versions.id DESC LIMIT 1) as 'sourceNode.nodeVersion.isAnonymous',\n" +
                "        targetNode.id AS 'targetNode.id',\n" +
                "        targetNode.type AS 'targetNode.type',\n" +
                "        targetNode.objectId AS 'targetNode.objectId',\n" +
                "        targetNode.isReal AS 'targetNode.isReal',\n" +
                "        targetNode.firstTimestamp AS 'targetNode.firstTimestamp',\n" +
                "        targetNode.isRedacted AS 'targetNode.isRedacted',\n" +
                "        (SELECT node_versions.displayName FROM node_versions WHERE node_versions.nodeId = links.targetNodeId AND node_versions.displayName IS NOT NULL ORDER BY node_versions.id DESC LIMIT 1) as 'targetNode.nodeVersion.displayName',\n" +
                "        (SELECT node_versions.avatarUrl FROM node_versions WHERE node_versions.nodeId = links.targetNodeId AND node_versions.avatarUrl IS NOT NULL ORDER BY node_versions.id DESC LIMIT 1) as 'targetNode.nodeVersion.avatarUrl',\n" +
                "        (SELECT node_versions.isAnonymous FROM node_versions WHERE node_versions.nodeId = links.targetNodeId AND node_versions.isAnonymous IS NOT NULL ORDER BY node_versions.id DESC LIMIT 1) as 'targetNode.nodeVersion.isAnonymous'\n" +
                "FROM timeline_events\n" +
                "JOIN links ON links.id = timeline_events.linkId\n" +
                "JOIN nodes AS sourceNode ON sourceNode.id = links.sourceNodeId\n" +
                "JOIN nodes AS targetNode ON targetNode.id = links.targetNodeId\n" +
                "WHERE timeline_events.timestamp > ?\n" +
                "LIMIT ?";

            this._db.all(query, since, limit, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }

                events = (rows || []).map(r => new CompleteTimelineEvent(r));

                this._db.get("SELECT COUNT(*) AS total FROM timeline_events WHERE timestamp > ?", since, (err, row) => {
                    if (err) reject(err);
                    else resolve({
                        remaining: Math.max(0, (row.total || 0) - events.length),
                        events: events
                    });
                });
            });
        });
    }

    /**
     * Gets the current meta state of a Node
     * @param {Node} node the node to lookup
     * @returns {Promise<{displayName: String?, avatarUrl: String?, isAnonymous: boolean}>} resolves to the Node's state
     */
    getCurrentNodeState(node) {
        return new Promise((resolve, reject) => {
            var query = "SELECT \n" +
                "(SELECT node_versions.displayName FROM node_versions WHERE node_versions.nodeId = ? AND node_versions.displayName IS NOT NULL ORDER BY node_versions.id DESC LIMIT 1) as 'displayName',\n" +
                "(SELECT node_versions.avatarUrl FROM node_versions WHERE node_versions.nodeId = ? AND node_versions.avatarUrl IS NOT NULL ORDER BY node_versions.id DESC LIMIT 1) as 'avatarUrl',\n" +
                "(SELECT node_versions.isAnonymous FROM node_versions WHERE node_versions.nodeId = ? AND node_versions.isAnonymous IS NOT NULL ORDER BY node_versions.id DESC LIMIT 1) as 'isAnonymous'";

            this._db.get(query, node.id, node.id, node.id, (err, row) => {
                if (err) reject(err);
                else {
                    row = row || {displayName: null, avatarUrl: null, isAnonymous: true};
                    if (!row.isAnonymous) row.isAnonymous = false; // change null -> false

                    resolve(row);
                }
            });
        });
    }

    /**
     * Gets all known nodes of the given type
     * @param {'user'|'room'} type the type of Node to lookup
     * @returns {Promise<Node[]>} resolves to a (potentially empty) collection of nodes
     */
    getNodesByType(type) {
        return new Promise((resolve, reject) => {
            this._db.all("SELECT * FROM nodes WHERE type = ?", type, (err, rows) => {
                if (err) reject(err);
                else {
                    rows = rows || [];
                    resolve(rows.map(r => new Node(r)));
                }
            });
        });
    }

    /**
     * Gets all known nodes from the store
     * @returns {Promise<CompleteNode[]>} resolves to a (potentially empty) collection of nodes
     */
    getAllNodes() {
        return new Promise((resolve, reject)=> {
            var query = "" +
                "SELECT nodes.*,\n" +
                "(SELECT node_versions.displayName FROM node_versions WHERE node_versions.nodeId = nodes.id AND node_versions.displayName IS NOT NULL ORDER BY node_versions.id DESC LIMIT 1) as 'displayName',\n" +
                "(SELECT node_versions.avatarUrl FROM node_versions WHERE node_versions.nodeId = nodes.id AND node_versions.avatarUrl IS NOT NULL ORDER BY node_versions.id DESC LIMIT 1) as 'avatarUrl',\n" +
                "(SELECT node_versions.isAnonymous FROM node_versions WHERE node_versions.nodeId = nodes.id AND node_versions.isAnonymous IS NOT NULL ORDER BY node_versions.id DESC LIMIT 1) as 'isAnonymous'\n" +
                "FROM nodes";
            this._db.all(query, (err, rows) => {
                if (err) reject(err);
                else {
                    rows = rows || [];
                    resolve(rows.map(r => new CompleteNode(r)));
                }
            });
        });
    }
}

function dbToBool(val) {
    return val === 1 || val === true;
}

function valOrDBNull(val) {
    if (typeof(val) === 'string' && val == '') return val;
    if (typeof(val) === 'boolean') return val;
    return val || null;
}

class Node {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.type = dbFields.type;
        this.objectId = dbFields.objectId;
        this.isReal = dbToBool(dbFields.isReal);
        this.firstTimestamp = dbFields.firstTimestamp;
        this.isRedacted = dbToBool(dbFields.isRedacted);
    }
}

class NodeVersion {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.nodeId = dbFields.nodeId;
        this.displayName = dbFields.displayName;
        this.avatarUrl = dbFields.avatarUrl;
        this.isAnonymous = dbToBool(dbFields.isAnonymous);
    }
}

class Link {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.type = dbFields.type;
        this.sourceNodeId = dbFields.sourceNodeId;
        this.targetNodeId = dbFields.targetNodeId;
        this.timestamp = dbFields.timestamp;
        this.isVisible = dbToBool(dbFields.isVisible);
        this.isRedacted = dbToBool(dbFields.isRedacted);
    }
}

class TimelineEvent {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.linkId = dbFields.linkId;
        this.timestamp = dbFields.timestamp;
        this.message = dbFields.message;
        this.matrixEventId = dbFields.matrixEventId;
    }
}

class StateEvent {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.type = dbFields.type;
        this.linkId = dbFields.linkId;
        this.nodeId = dbFields.nodeId;
        this.nodeVersionId = dbFields.nodeVersionId;
        this.timestamp = dbFields.timestamp;
    }
}

class CompleteNode extends Node {
    constructor(dbFields) {
        super(dbFields);

        this.currentMeta = {
            displayName: dbFields.displayName,
            avatarUrl: dbFields.avatarUrl,
            isAnonymous: dbToBool(dbFields.isAnonymous)
        };
    }
}

class CompleteStateEvent {
    constructor(dbFields) {
        var stateEvent = {};
        var link = {};
        var node = {};
        var nodeVersion = {};

        var hasLink = false;
        var hasNode = false;

        for(var key in dbFields) {
            var parts=key.split('.');
            switch(parts[0]) {
                case 'state_events':
                    stateEvent[parts[1]] = dbFields[key];
                    break;
                case 'links':
                    hasLink = true;
                    link[parts[1]] = dbFields[key];
                    break;
                case 'nodes':
                    hasNode = true;
                    node[parts[1]] = dbFields[key];
                    break;
                case 'node_versions':
                    hasNode = true;
                    nodeVersion[parts[1]] = dbFields[key];
                    break;
            }
        }

        this.stateEvent = new StateEvent(stateEvent);
        this.link = hasLink ? new Link(link) : null;
        this.node = hasNode ? new Node(node) : null;
        this.nodeVersion = hasNode ? new NodeVersion(node) : null;
    }
}

class CompleteTimelineEvent {
    constructor(dbFields) {
        var timelineEvent = {};
        var sourceNode = {};
        var targetNode = {};
        var link = {};
        var sourceNodeMeta = {displayName: null, avatarUrl: null, isAnonymous: null};
        var targetNodeMeta = {displayName: null, avatarUrl: null, isAnonymous: null};

        for (var key in dbFields) {
            var parts = key.split('.');
            switch (parts[0]) {
                case 'timeline_events':
                    timelineEvent[parts[1]] = dbFields[key];
                    break;
                case 'links':
                    link[parts[1]] = dbFields[key];
                    break;
                case 'sourceNode':
                    if (parts[1] == 'nodeVersion') {
                        if (parts[2] == 'isAnonymous') dbFields[key] = dbToBool(dbFields[key]);
                        sourceNodeMeta[parts[2]] = dbFields[key];
                    } else sourceNode[parts[1]] = dbFields[key];
                    break;
                case 'targetNode':
                    if (parts[1] == 'nodeVersion') {
                        if (parts[2] == 'isAnonymous') dbFields[key] = dbToBool(dbFields[key]);
                        targetNodeMeta[parts[2]] = dbFields[key];
                    } else targetNode[parts[1]] = dbFields[key];
                    break;
                default:
                    throw new Error("Unexpected key: " + key);
            }
        }

        this.event = new TimelineEvent(timelineEvent);
        this.link = new Link(link);
        this.sourceNode = new Node(sourceNode);
        this.targetNode = new Node(targetNode);
        this.sourceNodeMeta = sourceNodeMeta;
        this.targetNodeMeta = targetNodeMeta;
    }
}

module.exports = VoyagerStore;