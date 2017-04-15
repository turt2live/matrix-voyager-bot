var DBMigrate = require("db-migrate");
var log = require("npmlog");
var Sequelize = require('sequelize');
var dbConfig = require("../../config/database.json");

/**
 * Primary storage for Voyager.
 */
class VoyagerStore {

    constructor() {
        this._orm = null;
        this._enrolledIds = [];
    }

    /**
     * Prepares the store for use
     */
    prepare() {
        var env = process.env.NODE_ENV || "development";
        log.info("VoyagerStore", "Running migrations");
        return new Promise((resolve, reject)=> {
            var dbMigrate = DBMigrate.getInstance(true, {
                config: "./config/database.json",
                env: env
            });
            dbMigrate.up().then(() => {
                var driverMap = {
                    'sqlite3': 'sqlite',
                    'pg': 'postgres'
                };

                var dbConfigEnv = dbConfig[env];
                if (!dbConfigEnv) throw new Error("Could not find DB config for " + env);
                if (!driverMap[dbConfigEnv.driver]) throw new Error("Could not find dialect for driver " + dbConfigEnv.driver);

                var opts = {
                    host: dbConfigEnv.host || 'localhost',
                    dialect: driverMap[dbConfigEnv.driver],
                    pool: {
                        max: 5,
                        min: 0,
                        idle: 10000
                    },
                    logging: i => log.info("VoyagerStore [SQL]", i)
                };

                if (opts.dialect == 'sqlite')
                    opts.storage = dbConfigEnv.filename;

                this._orm = new Sequelize(dbConfigEnv.database || 'voyager', dbConfigEnv.username, dbConfigEnv.password, opts);
                this._bindModels();

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

    _bindModels() {
        // Models
        this.__Links = this._orm.import(__dirname + "/models/links");
        this.__NodeVersions = this._orm.import(__dirname + "/models/node_versions");
        this.__Nodes = this._orm.import(__dirname + "/models/nodes");
        this.__StateEvents = this._orm.import(__dirname + "/models/state_events");
        this.__TimelineEvents = this._orm.import(__dirname + "/models/timeline_events");

        // Relationships

        this.__Nodes.hasMany(this.__NodeVersions, {foreignKey: 'nodeId', targetKey: 'nodeId'});
        this.__NodeVersions.belongsTo(this.__Nodes, {foreignKey: 'nodeId'});

        this.__Links.belongsTo(this.__Nodes, {foreignKey: 'sourceNodeId'});
        this.__Links.belongsTo(this.__Nodes, {foreignKey: 'targetNodeId'});
        this.__Nodes.hasMany(this.__Links, {foreignKey: 'id', targetKey: 'sourceNodeId'});
        this.__Nodes.hasMany(this.__Links, {foreignKey: 'id', targetKey: 'targetNodeId'});

        this.__StateEvents.belongsTo(this.__Links, {foreignKey: 'linkId'});
        this.__StateEvents.belongsTo(this.__Nodes, {foreignKey: 'nodeId'});
        this.__StateEvents.belongsTo(this.__NodeVersions, {foreignKey: 'nodeVersionId'});
        this.__Links.hasMany(this.__StateEvents, {foreignKey: 'id', targetKey: 'linkId'});
        this.__Nodes.hasMany(this.__StateEvents, {foreignKey: 'id', targetKey: 'nodeId'});
        this.__NodeVersions.hasMany(this.__StateEvents, {foreignKey: 'id', targetKey: 'nodeVersionId'});

        this.__TimelineEvents.belongsTo(this.__Links, {foreignKey: 'linkId'});
        this.__Links.hasMany(this.__TimelineEvents, {foreignKey: 'id', targetKey: 'linkId'});
    }

    _populateEnrolledUsers() {
        log.info("VoyagerStore", "Populating enrolled users list...");
        return this.__Nodes.findAll({
            include: [{
                model: this.__NodeVersions,
                where: {
                    isAnonymous: {$not: null}
                },
                as: 'nodeVersions'
            }],
            where: {
                type: 'user',
                isReal: true
            }
        }).then(results => {
            for (var result of results) {
                var primaryVersion = null;
                for (var version of (result.nodeVersions || [])) {
                    if (!primaryVersion || primaryVersion.id < version.id)
                        primaryVersion = version;
                }

                if (!primaryVersion || primaryVersion.isAnonymous) continue;

                this._enrolledIds.push(result.objectId);
            }
            log.info("VoyagerStore", "Populated enrolled users. Found " + this._enrolledIds.length + " users enrolled");
        });
    }

    /**
     * Creates a new state event
     * @param {'node_added'|'node_removed'|'node_updated'|'link_added'|'link_removed'} type the type of event
     * @param {{nodeId: Number, nodeVersionId: Number}|{linkId: Number}} params the params for the event, must match the event type
     * @returns {Promise<StateEvent>} resolves to the created state event
     */
    createStateEvent(type, params) {
        switch (type) {
            case 'link_added':
            case 'link_removed':
                return this.__StateEvents.create({
                    type: type,
                    linkId: params.linkId,
                    timestamp: Sequelize.literal('CURRENT_TIMESTAMP')
                }).then(e => this.getStateEvent(e.id));
            case 'node_added':
            case 'node_removed':
            case 'node_updated':
                return this.__StateEvents.create({
                    type: type,
                    nodeId: params.nodeId,
                    nodeVersionId: params.nodeVersionId,
                    timestamp: Sequelize.literal('CURRENT_TIMESTAMP')
                }).then(e => this.getStateEvent(e.id));
            default:
                reject(new Error("State event type not known: " + type));
                break;
        }
    }

    /**
     * Gets a state event from the data store
     * @param {Number} id the event ID
     * @returns {Promise<StateEvent>} resolves to the state event, or null if not found
     */
    getStateEvent(id) {
        return this.__StateEvents.findById(id).then(e => e ? new StateEvent(e) : null);
    }

    /**
     * Creates a new Node
     * @param {'user'|'room'} type the type of Node
     * @param {string} objectId the object ID for the Node
     * @param {{displayName: String, avatarUrl: String, isAnonymous: boolean, primaryAlias: String}} firstVersion the first version of the Node
     * @param {boolean} isReal true if the node is a real node
     * @param {boolean} isRedacted true if the node should be redacted
     * @return {Promise<Node>} resolves to the created Node
     */
    createNode(type, objectId, firstVersion, isReal = true, isRedacted = false) {
        var node = null;
        return this.__Nodes.create({
            type: type,
            objectId: objectId,
            isReal: isReal,
            isRedacted: isRedacted,
            firstTimestamp: new Date(0)
        }).then(n => {
            node = n;
            return this.__NodeVersions.create({
                nodeId: node.id,
                displayName: firstVersion.displayName,
                avatarUrl: firstVersion.avatarUrl,
                isAnonymous: firstVersion.isAnonymous,
                primaryAlias: firstVersion.primaryAlias
            }, {
                fields: ['nodeId', 'displayName', 'avatarUrl', 'isAnonymous', 'primaryAlias']
            });
        }).then(nv => this.createStateEvent('node_added', {
            nodeId: node.id,
            nodeVersionId: nv.id
        })).then(() => this.getNodeById(node.id));
    }

    /**
     * Gets a Node from the data store
     * @param {Number} id the ID of the node
     * @returns {Promise<Node>} resolves to the found node, or null if not found
     */
    getNodeById(id) {
        return this.__Nodes.findById(id).then(n => n ? new Node(n) : null);
    }

    /**
     * Gets a Node from the data store
     * @param {'user'|'room} type the type of Node
     * @param {string} objectId the object ID of the Node
     * @returns {Promise<Node>} resolves to the found node, or null if not found
     */
    getNode(type, objectId) {
        return this.__Nodes.findOne({where: {type: type, objectId: objectId}}).then(n => n ? new Node(n) : null);
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
        return this.getNode('user', userId).then(node => {
            if (!node) Promise.reject(new Error("User node not found for user " + userId));
            else return this.createNodeVersion(node, {isAnonymous: !isEnrolled});
        }).then(() => {
            var idx = this._enrolledIds.indexOf(userId);
            if (isEnrolled && idx === -1)
                this._enrolledIds.push(userId);
            else if (!isEnrolled && idx !== -1)
                this._enrolledIds.splice(idx, 1);
        });
    }

    /**
     * Creates a new node version
     * @param {Node} node the node to append a version to
     * @param {{displayName: String?, avatarUrl: String?, isAnonymous: boolean?, primaryAlias: String?}} fields the fields to update
     * @returns {Promise<NodeVersion>} resolves with the created node version
     */
    createNodeVersion(node, fields) {
        var nodeVersion = null;
        return this.__NodeVersions.create({
            nodeId: node.id,
            displayName: valOrDBNull(fields.displayName),
            avatarUrl: valOrDBNull(fields.avatarUrl),
            isAnonymous: valOrDBNull(fields.isAnonymous),
            primaryAlias: valOrDBNull(fields.primaryAlias)
        }).then(nv => {
            nodeVersion = nv;
            return this.createStateEvent('node_updated', {
                nodeId: node.id,
                nodeVersionId: nodeVersion.id
            });
        }).then(() => this.getNodeVersionById(nodeVersion.id));
    }

    /**
     * Gets a node version from the data store
     * @param {Number} id the node version ID to look up
     * @returns {Promise<NodeVersion>} resolves to a node version, or null if not found
     */
    getNodeVersionById(id) {
        return this.__NodeVersions.findById(id).then(nv => nv ? new NodeVersion(nv) : null);
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
        var link = null;
        return this.__Links.create({
            type: type,
            sourceNodeId: sourceNode.id,
            targetNodeId: targetNode.id,
            timestamp: new Date(timestamp),
            isRedacted: isRedacted,
            isVisible: isVisible
        }).then(k=> {
            link = k;
            return this.createStateEvent('link_added', {linkId: link.id});
        }).then(() => this.getLinkById(link.id));
    }

    /**
     * Gets a link from the data store
     * @param {Number} id the link ID to look up
     * @returns {Promise<Link>} resolves to the found link, or null if not found
     */
    getLinkById(id) {
        return this.__Links.findById(id).then(k => k ? new Link(k) : null);
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
        var sourceNode;
        var targetNode;

        return this.__Nodes.findById(link.sourceNodeId).then(node => {
            sourceNode = node;
            return this.__Nodes.findById(link.targetNodeId);
        }).then(node => {
            targetNode = node;
            return this._updateNodeTimestamp(sourceNode, timestamp);
        }).then(() => {
            return this._updateNodeTimestamp(targetNode, timestamp);
        }).then(() => this.__TimelineEvents.create({
            linkId: link.id,
            timestamp: new Date(timestamp),
            message: message,
            matrixEventId: matrixEventId
        })).then(e => this.getTimelineEventById(e.id));
    }

    _updateNodeTimestamp(node, timestamp) {
        if (node.firstTimestamp.getTime() <= timestamp && node.firstTimestamp.getTime() != 0) return Promise.resolve();
        node.firstTimestamp = new Date(timestamp);
        return node.save();
    }

    /**
     * Gets a timeline event from the data store
     * @param {number} id the timeline event ID to lookup
     * @returns {Promise<TimelineEvent>} resolves to the timeline event, or null if not found
     */
    getTimelineEventById(id) {
        return this.__TimelineEvents.findById(id).then(e => e ? new TimelineEvent(e) : null);
    }

    /**
     * Attempts to find a given Link
     * @param {Node} sourceNode the source node
     * @param {Node} targetNode the target node
     * @param {'invite'|'message'|'self_link'|'kick'|'ban'} type the link type
     * @returns {Promise<Link>} resolves with the found link, or null
     */
    findLink(sourceNode, targetNode, type) {
        return this.__TimelineEvents.findOne({
            where: {
                sourceNodeId: sourceNode.id,
                targetNodeId: targetNode.id,
                type: type
            }
        }).then(k => k ? new Link(k) : null);
    }

    /**
     * Updates a node to be redacted
     * @param {Node} node the node to be redacted
     * @returns {Promise} resolves when the node has been updated
     */
    redactNode(node) {
        return this.__Nodes.findById(node.id)
            .then(n => {
                n.isRedacted = true;
                return n.save();
            })
            .then(() => this.getCurrentNodeVersionForNode(node))
            .then(version => this.createStateEvent('node_removed', {
                nodeId: node.id,
                nodeVersionId: version.id
            }));
    }

    /**
     * Gets the current node version for a given node from the data store
     * @param {Node} node the node to look up the version of
     * @returns {Promise<NodeVersion>} resolves to the found node version, or null if none was found
     */
    getCurrentNodeVersionForNode(node) {
        return this.__NodeVersions.findOne({where: {nodeId: node.id}, order: 'id DESC'}).then(nv => nv ? new NodeVersion(nv) : null);
    }

    /**
     * Updates a link to be redacted
     * @param {Link} link the link to be redacted
     * @returns {Promise} resolves when the link has been updated
     */
    redactLink(link) {
        return this.__Links.findById(link.id)
            .then(k => {
                k.isRedacted = true;
                return k.save();
            })
            .then(() => this.createStateEvent('link_removed', {linkId: link.id}));
    }

    /**
     * Gets all of the state events for the given range
     * @param {Number} since the timestamp to start the search from, exclusive
     * @param {Number} limit the total number of results to search for
     * @returns {Promise<{remaining: Number, events: CompleteStateEvent[]}>} resolves to information about the results. May be an empty array
     */
    getStateEventsPaginated(since, limit) {
        var linkResults = {count: 0, rows: []};
        var nodeResults = {count: 0, rows: []};

        return this.__StateEvents.findAndCountAll({
            where: {
                linkId: {$not: null},
                timestamp: {$gt: since}
            },
            include: [{
                model: this.__Links,
                as: 'link'
            }],
            limit: limit
        }).then(lse=> {
            linkResults = lse;
            return this.__StateEvents.findAndCountAll({
                where: {
                    nodeId: {$not: null},
                    timestamp: {$gt: since}
                },
                include: [{
                    model: this.__Nodes,
                    as: 'node',
                    include: [{
                        model: this.__NodeVersions,
                        as: 'nodeVersions'
                    }]
                }],
                limit: limit
            });
        }).then(nse=> {
            nodeResults = nse;

            var linkEvents = linkResults.rows.map(r => new CompleteStateEvent(r));
            var nodeEvents = nodeResults.rows.map(r => new CompleteStateEvent(r));

            var events = [];
            for (var row of linkEvents) events.push(row);
            for (var row of nodeEvents) events.push(row);

            events.sort((a, b) => a.stateEvent.timestamp - b.stateEvent.timestamp);

            // Be sure to respect the limit
            events = events.splice(0, limit);

            var remaining = (linkResults.count + nodeResults.count) - events.length;
            return {
                remaining: remaining,
                events: events
            };
        })
    }

    /**
     * Gets the number of timeline events that occur after the given timestamp
     * @param {Number} timestamp the timestamp to search from
     * @returns {Promise<number>} resolves to the number of remaining events
     */
    getCountTimelineEventsAfter(timestamp) {
        return this.__TimelineEvents.count({where: {timestamp: {$gt: timestamp}}});
    }

    /**
     * Gets all of the timeline events for the given range
     * @param {Number} since the timestamp to start the search from, exclusive
     * @param {Number} limit the total number of results to search for
     * @returns {Promise<{remaining: Number, events: CompleteTimelineEvent[]}>} resolves to information about the results. May be an empty array
     */
    getTimelineEventsPaginated(since, limit) {
        return this.__TimelineEvents.findAndCountAll({
            where: {
                timestamp: {$gt: since}
            },
            include: [{
                model: this.__Links,
                as: 'link',
                include: [{
                    model: this.__Nodes,
                    as: 'sourceNode',
                    include: [{
                        model: this.__NodeVersions,
                        as: 'nodeVersions'
                    }]
                }, {
                    model: this.__Nodes,
                    as: 'targetNode',
                    include: [{
                        model: this.__NodeVersions,
                        as: 'nodeVersions'
                    }]
                }]
            }],
            limit: limit
        }).then(results => {
            var events = results.rows.map(r => new CompleteTimelineEvent(r));
            return {
                remaining: results.count - events.length,
                events: events
            };
        });
    }

    /**
     * Gets the current meta state of a Node
     * @param {Node} node the node to lookup
     * @returns {Promise<{displayName: String?, avatarUrl: String?, isAnonymous: boolean, primaryAlias: String?}>} resolves to the Node's state
     */
    getCurrentNodeState(node) {
        return this.__NodeVersions.findAll({
            where: {
                nodeId: node.id
            }
        }).then(versions => {
            var dto = {nodeVersions: versions};
            var meta = calculateNodeMeta(dto);
            if (!meta.isAnonymous) meta.isAnonymous = false; // change null -> false
            return meta;
        });
    }

    /**
     * Gets all known nodes of the given type
     * @param {'user'|'room'} type the type of Node to lookup
     * @returns {Promise<Node[]>} resolves to a (potentially empty) collection of nodes
     */
    getNodesByType(type) {
        return this.__Nodes.findAll({
            where: {
                type: type
            }
        }).then(nodes => (nodes || []).map(n => new Node(n)));
    }

    /**
     * Gets all known nodes from the store
     * @returns {Promise<CompleteNode[]>} resolves to a (potentially empty) collection of nodes
     */
    getAllNodes() {
        return this.__Nodes.findAll({
            include: {
                model: this.__NodeVersions,
                as: 'nodeVersions'
            }
        }).then(nodes => {
            return nodes.map(r => new CompleteNode(r));
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

function calculateNodeMeta(node) {
    var nv = {
        displayName: {val: null, id: 0},
        avatarUrl: {val: null, id: 0},
        isAnonymous: {val: false, id: 0},
        primaryAlias: {val: null, id: 0}
    };

    for (var version of node.nodeVersions) {
        if (version.displayName !== null && version.id > nv.displayName.id) {
            nv.displayName.val = version.displayName;
            nv.displayName.id = version.id;
        }
        if (version.avatarUrl !== null && version.id > nv.avatarUrl.id) {
            nv.avatarUrl.val = version.avatarUrl;
            nv.avatarUrl.id = version.id;
        }
        if (version.isAnonymous !== null && version.id > nv.isAnonymous.id) {
            nv.isAnonymous.val = version.isAnonymous;
            nv.isAnonymous.id = version.id;
        }
        if (version.primaryAlias !== null && version.id > nv.primaryAlias.id) {
            nv.primaryAlias.val = version.primaryAlias;
            nv.primaryAlias.id = version.id;
        }
    }

    return {
        displayName: nv.displayName.val,
        avatarUrl: nv.avatarUrl.val,
        isAnonymous: nv.isAnonymous.val,
        primaryAlias: nv.primaryAlias.val
    };
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
        this.primaryAlias = dbFields.primaryAlias;
    }
}

class Link {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.type = dbFields.type;
        this.sourceNodeId = dbFields.sourceNodeId;
        this.targetNodeId = dbFields.targetNodeId;
        this.timestamp = dbFields.timestamp.getTime();
        this.isVisible = dbToBool(dbFields.isVisible);
        this.isRedacted = dbToBool(dbFields.isRedacted);
    }
}

class TimelineEvent {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.linkId = dbFields.linkId;
        this.timestamp = dbFields.timestamp.getTime();
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
        this.timestamp = dbFields.timestamp.getTime();
    }
}

class CompleteNode extends Node {
    constructor(dbFields) {
        super(dbFields);

        this.currentMeta = calculateNodeMeta(dbFields.nodeVersions);
    }
}

class CompleteStateEvent {
    constructor(dbFields) {
        this.stateEvent = dbFields;
        this.link = dbFields.link || null;
        this.node = dbFields.node || null;

        if (this.node)
            this.nodeVersion = calculateNodeMeta(this.node);
    }
}

class CompleteTimelineEvent {
    constructor(dbFields) {
        this.event = new StateEvent(dbFields);
        this.link = new Link(dbFields.link);
        this.sourceNode = new Node(dbFields.link.sourceNode);
        this.targetNode = new Node(dbFields.link.targetNode);
        this.sourceNodeMeta = calculateNodeMeta(this.sourceNode);
        this.targetNodeMeta = calculateNodeMeta(this.targetNode);
    }
}

module.exports = VoyagerStore;