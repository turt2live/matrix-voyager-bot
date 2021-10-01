var DBMigrate = require("db-migrate");
var log = require("./../LogService");
var Sequelize = require('sequelize');
var dbConfig = require("../../config/database.json");
var map = require("promise-map");
var Promise = require('bluebird');
var _ = require("lodash");

/**
 * Primary storage for Voyager.
 */
class VoyagerStore {

    constructor() {
        this._orm = null;
        this._enrolledIds = [];
        this._isPsql = false;
    }

    /**
     * Prepares the store for use
     */
    prepare() {
        var env = process.env.NODE_ENV || "development";
        log.info("VoyagerStore", "Running migrations");
        return new Promise((resolve, reject) => {
            var dbMigrate = DBMigrate.getInstance(true, {
                config: "./config/database.json",
                env: env
            });
            dbMigrate.up().then(() => {
                var driverMap = {
                    // 'sqlite3': 'sqlite',
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
                    logging: i => log.verbose("VoyagerStore [SQL]", i)
                };

                if (opts.dialect == 'sqlite')
                    opts.storage = dbConfigEnv.filename;
                else this._isPsql = true;

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
        this.__NodeMeta = this._orm.import(__dirname + "/models/node_meta");
        this.__NodeAliases = this._orm.import(__dirname + "/models/node_aliases");
        this.__Dnt = this._orm.import(__dirname + "/models/dnt");

        // Relationships

        this.__Nodes.hasMany(this.__NodeVersions, {foreignKey: 'nodeId', targetKey: 'nodeId'});
        this.__NodeVersions.belongsTo(this.__Nodes, {foreignKey: 'nodeId'});

        this.__Nodes.hasMany(this.__NodeAliases, {foreignKey: 'nodeId', targetKey: 'nodeId'});
        this.__NodeAliases.belongsTo(this.__Nodes, {foreignKey: 'nodeId'});

        this.__Links.belongsTo(this.__Nodes, {foreignKey: 'sourceNodeId', as: 'sourceNode'});
        this.__Links.belongsTo(this.__Nodes, {foreignKey: 'targetNodeId', as: 'targetNode'});
        this.__Nodes.hasMany(this.__Links, {foreignKey: 'id', targetKey: 'sourceNodeId', as: 'sourceNode'});
        this.__Nodes.hasMany(this.__Links, {foreignKey: 'id', targetKey: 'targetNodeId', as: 'targetNode'});

        this.__StateEvents.belongsTo(this.__Links, {foreignKey: 'linkId'});
        this.__StateEvents.belongsTo(this.__Nodes, {foreignKey: 'nodeId'});
        this.__StateEvents.belongsTo(this.__NodeVersions, {foreignKey: 'nodeVersionId'});
        this.__Links.hasMany(this.__StateEvents, {foreignKey: 'id', targetKey: 'linkId'});
        this.__Nodes.hasMany(this.__StateEvents, {foreignKey: 'id', targetKey: 'nodeId'});
        this.__NodeVersions.hasMany(this.__StateEvents, {foreignKey: 'id', targetKey: 'nodeVersionId'});

        this.__TimelineEvents.belongsTo(this.__Links, {foreignKey: 'linkId', as: 'link'});
        this.__Links.hasMany(this.__TimelineEvents, {foreignKey: 'id', targetKey: 'linkId', as: 'link'});

        this.__Nodes.belongsTo(this.__NodeMeta, {as: 'nodeMeta', foreignKey: 'nodeMetaId'});
        this.__NodeMeta.belongsTo(this.__Nodes, {as: 'nodeMeta', foreignKey: 'nodeId'});
    }

    _populateEnrolledUsers() {
        log.info("VoyagerStore", "Populating enrolled users list...");
        if (this._isPsql) {
            // Optimize query for postgres users
            return this._orm.query("SELECT \"objectId\" FROM nodes JOIN node_meta ON node_meta.\"nodeId\" = nodes.\"id\" WHERE \"isReal\" = true AND \"isAnonymous\" = false AND \"type\" = 'user'").then((results, metadata) => {
                this._enrolledIds = results;
            });
        }
        return this.__Nodes.findAll({
            include: [{
                model: this.__NodeMeta,
                as: 'nodeMeta'
            }],
            where: {
                type: 'user',
                isReal: true
            }
        }).then(results => {
            for (var result of results) {
                if (!result.nodeMeta || result.nodeMeta.isAnonymous) continue;
                this._enrolledIds.push(result.objectId);
            }
            log.info("VoyagerStore", "Populated enrolled users. Found " + this._enrolledIds.length + " users enrolled");
        });
    }

    /**
     * Sets the Do Not Track state for a user.
     * @param {string} userId the user ID to set the state for
     * @param {boolean} dntState if true, the user will no longer be tracked. False to permit tracking (the default)
     * @returns {Promise<*>} resolves when the state has been updated
     */
    setDnt(userId, dntState) {
        return this.__Dnt.findAll({where: {userId: userId}})
            .then(flags => Promise.all(flags.map(f => f.destroy())))
            .then(() => this.__Dnt.create({userId: userId, isDnt: dntState}));
    }

    /**
     * Gets whether or not a user has asked to not be tracked by the bot
     * @param {string} userId the user ID to look up
     * @returns {Promise<boolean>} resolves to the track status of the user (true is 'do not track').
     */
    isDnt(userId) {
        return this.__Dnt.findAll({where: {userId: userId}}).then(flags => {
            var dnt = false;
            for (var flag of flags) {
                if (flag.isDnt) {
                    dnt = true;
                    break;
                }
            }

            return dnt;
        });
    }

    /**
     * Creates a new state event
     * @param {'node_added'|'node_removed'|'node_updated'|'node_restored'|'link_added'|'link_removed'} type the type of event
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
            case 'node_restored':
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
        return this.__StateEvents.findByPk(id).then(e => e ? new StateEvent(e) : null);
    }

    /**
     * Creates a new Node
     * @param {'user'|'room'} type the type of Node
     * @param {string} objectId the object ID for the Node
     * @param {{displayName: String, avatarUrl: String, isAnonymous: boolean, primaryAlias: String}} firstVersion the first version of the Node
     * @param {string[]} aliases the aliases for the node, optional
     * @param {boolean} isReal true if the node is a real node
     * @param {boolean} isRedacted true if the node should be redacted
     * @return {Promise<Node>} resolves to the created Node
     */
    createNode(type, objectId, firstVersion, aliases = [], isReal = true, isRedacted = false) {
        var node = null;
        var nodeMeta = null;
        return this.__NodeMeta.create({
            displayName: firstVersion.displayName,
            avatarUrl: firstVersion.avatarUrl,
            isAnonymous: firstVersion.isAnonymous,
            primaryAlias: firstVersion.primaryAlias
        }).then(meta => {
            nodeMeta = meta;
            return this.__Nodes.create({
                type: type,
                objectId: objectId,
                isReal: isReal,
                isRedacted: isRedacted,
                firstTimestamp: new Date(0),
                nodeMetaId: nodeMeta.id
            });
        }).then(n => {
            node = n;
            return this.__NodeVersions.create({
                nodeId: node.id,
                displayName: firstVersion.displayName,
                avatarUrl: firstVersion.avatarUrl,
                isAnonymous: firstVersion.isAnonymous,
                primaryAlias: firstVersion.primaryAlias
            });
        }).then(nv => this.createStateEvent('node_added', {
            nodeId: node.id,
            nodeVersionId: nv.id
        })).then(() => {
            nodeMeta.nodeId = node.id;
            return nodeMeta.save();
        }).then(() => {
            return this.setNodeAliases(node, aliases || []);
        }).then(() => this.getNodeById(node.id));
    }

    /**
     * Gets a Node from the data store
     * @param {Number} id the ID of the node
     * @returns {Promise<Node>} resolves to the found node, or null if not found
     */
    getNodeById(id) {
        return this.__Nodes.findByPk(id).then(n => n ? new Node(n) : null);
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
     * @param {{displayName: String?, avatarUrl: String?, isAnonymous: boolean?, primaryAlias: String?, userCount: Number?, serverCount: Number?, aliasCount: Number?}} fields the fields to update
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
        }).then(() => this.__NodeMeta.findOne({where: {nodeId: node.id}})).then(nodeMeta => {
            var displayName = valOrDBNull(fields.displayName);
            var avatarUrl = valOrDBNull(fields.avatarUrl);
            var isAnonymous = valOrDBNull(fields.isAnonymous);
            var primaryAlias = valOrDBNull(fields.primaryAlias);
            var userCount = valOrDBNull(fields.userCount);
            var serverCount = valOrDBNull(fields.serverCount);
            var aliasCount = valOrDBNull(fields.aliasCount);

            var changed = false;

            if (displayName !== null && nodeMeta.displayName != displayName) {
                nodeMeta.displayName = displayName;
                changed = true;
            }
            if (avatarUrl !== null && nodeMeta.avatarUrl != avatarUrl) {
                nodeMeta.avatarUrl = avatarUrl;
                changed = true;
            }
            if (isAnonymous !== null && nodeMeta.isAnonymous != isAnonymous) {
                nodeMeta.isAnonymous = isAnonymous;
                changed = true;
            }
            if (primaryAlias !== null && nodeMeta.primaryAlias != primaryAlias) {
                nodeMeta.primaryAlias = primaryAlias;
                changed = true;
            }
            if (userCount !== nodeMeta.userCount) {
                nodeMeta.userCount = userCount;
                changed = true;
            }
            if (serverCount !== nodeMeta.serverCount) {
                nodeMeta.serverCount = serverCount;
                changed = true;
            }
            if (aliasCount !== nodeMeta.aliasCount) {
                nodeMeta.aliasCount = aliasCount;
                changed = true;
            }

            if (changed) return nodeMeta.save();
            else return Promise.resolve();
        }).then(() => this.getNodeVersionById(nodeVersion.id));
    }

    /**
     * Gets a node version from the data store
     * @param {Number} id the node version ID to look up
     * @returns {Promise<NodeVersion>} resolves to a node version, or null if not found
     */
    getNodeVersionById(id) {
        return this.__NodeVersions.findByPk(id).then(nv => nv ? new NodeVersion(nv) : null);
    }

    /**
     * Attempts to find a link where the given source node, target node, type, and timeline
     * event exist.
     * @param {Node} sourceNode the source Node
     * @param {Node} targetNode the target Node
     * @param {'invite'|'message'|'self_link'|'kick'|'ban'|'soft_kick'} type the link type
     * @param {string} matrixEventId the timeline event ID
     * @returns {Promise<Link>} resovles to the first found link, or null if not found
     */
    findLinkByTimeline(sourceNode, targetNode, type, matrixEventId) {
        return this.__TimelineEvents.findAll({
            where: {matrixEventId: matrixEventId},
            include: [{
                model: this.__Links,
                where: {
                    type: type,
                    sourceNodeId: sourceNode.id,
                    targetNodeId: targetNode.id
                },
                as: 'link'
            }]
        }).then(events => {
            if (!events) return Promise.resolve(null);

            for (var event of events) {
                if (event.link) return Promise.resolve(event.link);
            }

            return Promise.resolve(null);
        });
    }

    /**
     * Creates a new Link
     * @param {Node} sourceNode the source Node
     * @param {Node} targetNode the target Node
     * @param {'invite'|'message'|'self_link'|'kick'|'ban'|'soft_kick'} type the link type
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
        }).then(k => {
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
        return this.__Links.findByPk(id).then(k => k ? new Link(k) : null);
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

        return this.__Nodes.findByPk(link.sourceNodeId).then(node => {
            sourceNode = node;
            return this.__Nodes.findByPk(link.targetNodeId);
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
        if (typeof(node.firstTimestamp) === "string") node.firstTimestamp = Number(node.firstTimestamp);
        if (typeof(node.firstTimestamp) === "number") node.firstTimestamp = new Date(node.firstTimestamp);
        var timezoneOffset = node.firstTimestamp.getTimezoneOffset() * -60000;
        var time = node.firstTimestamp.getTime() - timezoneOffset;
        // HACK: All matrix events should be after 2014 and dates default to 1970 for 0. Treat anything over 2000 as valid as a fallback.
        if (time <= timestamp && time != 0 && node.firstTimestamp.getFullYear() > 2000) return Promise.resolve();
        node.firstTimestamp = new Date(timestamp);
        return node.save();
    }

    /**
     * Gets a timeline event from the data store
     * @param {number} id the timeline event ID to lookup
     * @returns {Promise<TimelineEvent>} resolves to the timeline event, or null if not found
     */
    getTimelineEventById(id) {
        return this.__TimelineEvents.findByPk(id).then(e => e ? new TimelineEvent(e) : null);
    }

    /**
     * Attempts to find a given Link
     * @param {Node} sourceNode the source node
     * @param {Node} targetNode the target node
     * @param {'invite'|'message'|'self_link'|'kick'|'ban'|'soft_kick'} type the link type
     * @returns {Promise<Link>} resolves with the found link, or null
     */
    findLink(sourceNode, targetNode, type) {
        return this.__Links.findOne({
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
        return this.__Nodes.findByPk(node.id)
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
     * Updates a node to be unredacted
     * @param {Node} node the node to be unredacted
     * @returns {Promise} resolves when the node has been updated
     */
    unredactNode(node) {
        return this.__Nodes.findByPk(node.id)
            .then(n => {
                n.isRedacted = false;
                return n.save();
            })
            .then(() => this.getCurrentNodeVersionForNode(node))
            .then(version => this.createStateEvent('node_restored', {
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
        return this.__NodeVersions.findOne({
            where: {nodeId: node.id},
            order: [['id', 'DESC']]
        }).then(nv => nv ? new NodeVersion(nv) : null);
    }

    /**
     * Updates a link to be redacted
     * @param {Link} link the link to be redacted
     * @returns {Promise} resolves when the link has been updated
     */
    redactLink(link) {
        return this.__Links.findByPk(link.id)
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
                timestamp: {$gt: new Date(since)}
            },
            include: [{
                model: this.__Links,
                as: 'link'
            }],
            limit: limit
        }).then(lse => {
            linkResults = lse;
            return this.__StateEvents.findAndCountAll({
                where: {
                    nodeId: {$not: null},
                    timestamp: {$gt: since}
                },
                include: [{
                    model: this.__Nodes,
                    as: 'node'
                }, {
                    model: this.__NodeVersions,
                    as: 'nodeVersion'
                }],
                limit: limit
            });
        }).then(nse => {
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
        return this.__TimelineEvents.count({where: {timestamp: {$gt: new Date(timestamp)}}});
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
                timestamp: {$gt: new Date(since)}
            },
            include: [{
                model: this.__Links,
                as: 'link',
                include: [{
                    model: this.__Nodes,
                    as: 'sourceNode',
                    include: [{
                        model: this.__NodeMeta,
                        as: 'nodeMeta'
                    }]
                }, {
                    model: this.__Nodes,
                    as: 'targetNode',
                    include: [{
                        model: this.__NodeMeta,
                        as: 'nodeMeta'
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
        return this.__NodeMeta.findOne({where: {nodeId: node.id}}).then(meta => {
            if (!meta) meta = {id: 0, displayName: null, avatarUrl: null, isAnonymous: true, primaryAlias: null};
            if (!meta.isAnonymous) meta.isAnonymous = false; // change null -> false
            return new NodeMeta(meta);
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
            include: [{
                model: this.__NodeMeta,
                as: 'nodeMeta'
            }]
        }).then(rows => rows.map(r => new CompleteNode(r)));
    }

    /**
     * Gets all public rooms from the store. Public rooms are rooms with at least one alias, are not anonymous,
     * and are not redacted.
     * @returns {Promise<CompleteNode[]>} resolves to the public rooms
     */
    getPublicRooms() {
        return this.__Nodes.findAll({
            include: [{
                model: this.__NodeMeta,
                as: 'nodeMeta'
            }],
            where: {
                type: 'room',
                isRedacted: false,
            },
            order: [['id', 'DESC']]
        }).then(results => {
            var rooms = [];
            for (var room of results) {
                var node = new CompleteNode(room);
                if (!node.currentMeta.primaryAlias) continue;
                if (node.currentMeta.isAnonymous) continue;

                rooms.push(node);
            }

            var promise = Promise.resolve();
            var allowedRooms = [];
            rooms.map(n => promise = promise.then(() => {
                return this.__Links.findAll({
                    where: {
                        $or: [
                            {sourceNodeId: n.id},
                            {targetNodeId: n.id}
                        ]
                    }
                }).then(links => {
                    for (var link of links)
                        if (link.type === 'kick' || link.type === 'ban') return;

                    allowedRooms.push(n);
                });
            }));

            return promise.then(() => allowedRooms);
        });
    }

    /**
     * Gets an array of public nodes that have an alias available. Only nodes with meta information or
     * aliases containing the keywords will be returned (either the display name or any other alias). This
     * performs a very rough check and may require additional processing to get useful results.
     * @param {String[]} keywords the list of terms/keywords to search for
     * @returns {Promise<NodeSearchResult[]>} resolves to the array of nodes matching the criteria
     */
    findNodesMatching(keywords) {
        var likeCondition = keywords.map(k => "%" + k + "%");

        var rawMeta = null;
        var rawAliases = null;
        var redactedNodeIds = null;
        var nodeMap = {}; // { id: NodeSearchResult }

        var redactedNodesPromise = this.__Nodes.findAll({where: {isRedacted: true}})
            .then(nodes => redactedNodeIds = (nodes || []).map(n => n.id));

        var metaPromise = this.__NodeMeta.findAll({
            where: {
                $and: [
                    // {primaryAlias: {$not: null, $ne: ''}},
                    {isAnonymous: false},
                    {
                        $or: likeCondition.map(k => {
                            return {primaryAlias: (this._isPsql ? {$iLike: k} : {$like: k})};
                        }).concat(likeCondition.map(k => {
                            return {displayName: (this._isPsql ? {$iLike: k} : {$like: k})};
                        }))
                    },
                ]
            }
        }).then(meta => rawMeta = (meta || []).map(m => new NodeMeta(m)));

        var aliasPromise = this.__NodeAliases.findAll({
            where: {
                $or: likeCondition.map(k => {
                    return {alias: (this._isPsql ? {$iLike: k} : {$like: k})};
                })
            }
        }).then(aliases => rawAliases = (aliases || []).map(a => new NodeAlias(a)));

        return Promise.all([metaPromise, aliasPromise, redactedNodesPromise]).then(() => {
            for (var meta of rawMeta) {
                if (!nodeMap[meta.nodeId])
                    nodeMap[meta.nodeId] = new NodeSearchResult(meta.nodeId);
                nodeMap[meta.nodeId].meta = meta;
            }

            for (var alias of rawAliases) {
                if (!nodeMap[alias.nodeId])
                    nodeMap[alias.nodeId] = new NodeSearchResult(alias.nodeId);
                if (!nodeMap[alias.nodeId].aliases)
                    nodeMap[alias.nodeId].aliases = [];
                nodeMap[alias.nodeId].aliases.push(alias);
            }

            var missingMeta = [];
            for (var nodeId in nodeMap) {
                var nodeInfo = nodeMap[nodeId];
                if (!nodeInfo.meta) {
                    missingMeta.push(nodeId);
                }
            }

            return this.__NodeMeta.findAll({where: {nodeId: {$in: missingMeta}}});
        }).then(foundMeta => {
            for (var meta of foundMeta) {
                if (!nodeMap[meta.nodeId])
                    nodeMap[meta.nodeId] = new NodeSearchResult(meta.nodeId);
                nodeMap[meta.nodeId].meta = new NodeMeta(meta);
            }

            var finalNodes = [];

            for (var nodeId in nodeMap) {
                var nodeInfo = nodeMap[nodeId];
                if (!nodeInfo.meta) continue; // we automatically refuse anything that doesn't have meta (because this shouldn't happen)
                if (redactedNodeIds.indexOf(nodeInfo.meta.nodeId) !== -1) continue; // refuse anything that is redacted
                if (nodeInfo.meta.primaryAlias || (nodeInfo.aliases && nodeInfo.aliases.length > 0))
                    finalNodes.push(nodeInfo);
            }

            return finalNodes;
        }).then(nodes => {
            var promise = Promise.resolve();
            _.forEach(nodes, node => {
                promise = promise.then(() => {
                    return this.__Links.findAll({
                        where: {
                            $or: [
                                {sourceNodeId: node.id},
                                {targetNodeId: node.id}
                            ]
                        }
                    });
                }).then(links => {
                    for (var link of links) {
                        if (link.sourceNodeId === link.targetNodeId) continue;
                        node.mentionCount++;
                    }
                });
            });
            return promise.then(() => nodes);
        });
    }

    /**
     * Sets the aliases for a given node
     * @param {Node} node the node to update
     * @param {String[]} aliases the aliases to set for the node
     * @returns {Promise} resolves when complete
     */
    setNodeAliases(node, aliases) {
        return this.__NodeAliases.findAll({where: {nodeId: node.id}})
            .then(nodes => Promise.all(nodes.map(n => n.destroy())))
            .then(() => Promise.all(aliases.map(a => this.__NodeAliases.create({nodeId: node.id, alias: a}))));
    }

    /**
     * Gets all of the aliases for a given node
     * @param {Node} node the node to lookup aliases for
     * @returns {Promise<NodeAlias[]>} resolves to the list of known aliases
     */
    getNodeAliases(node) {
        return this.__NodeAliases.findAll({where: {nodeId: node.id}}).then(aliases => aliases.map(a => new NodeAlias(a)));
    }

    /**
     * Gets basic information about where Voyager has been
     * @returns {Promise<StatsContainer>} resolves to the stats about voyager
     */
    getBasicStats() {
        if (!this._isPsql) return this._getSqliteBasicStats();

        var statsContainer = {rooms: 0, aliases: 0, users: 0, servers: 0, mentions: 0};
        var select = {type: Sequelize.QueryTypes.SELECT};

        return this._orm.query("SELECT COUNT(*) AS rooms FROM nodes WHERE \"type\"='room'", select).then(roomStats => {
            statsContainer.rooms = roomStats[0].rooms;
            return this._orm.query("SELECT COUNT(*) AS aliases FROM node_aliases", select);
        }).then(aliasStats => {
            statsContainer.aliases = aliasStats[0].aliases;
            return this._orm.query("SELECT COUNT(*) AS mentions FROM links WHERE \"type\"='message'", select);
        }).then(mentionStats => {
            statsContainer.mentions = mentionStats[0].mentions;
            return this._orm.query("SELECT COUNT(*) AS users FROM nodes WHERE \"type\"='user'", select);
        }).then(userStats => {
            statsContainer.users = userStats[0].users;
            return this._orm.query("SELECT COUNT(DISTINCT (STRING_TO_ARRAY(\"objectId\", ':')::text[])[2]) AS servers FROM nodes", select);
        }).then(serverStats => {
            statsContainer.servers = serverStats[0].servers;
        }).then(() => statsContainer);
    }

    _getSqliteBasicStats() {
        var statsContainer = {rooms: 0, aliases: 0, users: 0, servers: 0, mentions: 0};
        var select = {type: Sequelize.QueryTypes.SELECT};

        return this._orm.query("SELECT COUNT(*) AS rooms FROM nodes WHERE type='room'", select).then(roomStats => {
            statsContainer.rooms = roomStats[0].rooms;
            return this._orm.query("SELECT COUNT(*) AS aliases FROM node_aliases", select);
        }).then(aliasStats => {
            statsContainer.aliases = aliasStats[0].aliases;
            return this._orm.query("SELECT COUNT(*) AS mentions FROM links WHERE type='message'", select);
        }).then(mentionStats => {
            statsContainer.mentions = mentionStats[0].mentions;
            return this._orm.query("SELECT COUNT(*) AS users FROM nodes WHERE type='user'", select);
        }).then(userStats => {
            statsContainer.users = userStats[0].users;
            return this._orm.query("SELECT objectId AS objectId FROM nodes", select);
        }).then(objectIds => {
            var servers = [];
            for (var obj of objectIds) {
                var serverParts = obj.objectId.split(':');
                var server = serverParts[serverParts.length - 1];
                if (servers.indexOf(server) === -1) servers.push(server);
            }

            statsContainer.servers = servers.length;
        }).then(() => statsContainer);
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

function timestamp(val) {
    if (typeof(val) === 'number') {
        return val;
    } else if (typeof(val) === 'string') {
        return new Date(val).getTime();
    } else return (val || new Date(0)).getTime();
}

class Node {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.type = dbFields.type;
        this.objectId = dbFields.objectId;
        this.isReal = dbToBool(dbFields.isReal);
        this.isRedacted = dbToBool(dbFields.isRedacted);
        this.firstTimestamp = timestamp(dbFields.firstTimestamp);
    }
}

class NodeMeta {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.displayName = dbFields.displayName;
        this.avatarUrl = dbFields.avatarUrl;
        this.isAnonymous = dbToBool(dbFields.isAnonymous);
        this.primaryAlias = dbFields.primaryAlias;
        this.nodeId = dbFields.nodeId;
        this.userCount = dbFields.userCount;
        this.serverCount = dbFields.serverCount;
        this.aliasCount = dbFields.aliasCount;
    }
}

class NodeAlias {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.alias = dbFields.alias;
        this.nodeId = dbFields.nodeId;
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

class NodeSearchResult {
    constructor(nodeId) {
        this.id = nodeId;
        this.meta = null; // NodeMeta
        this.aliases = []; // NodeAlias[]
        this.mentionCount = 0;
    }
}

class Link {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.type = dbFields.type;
        this.sourceNodeId = dbFields.sourceNodeId;
        this.targetNodeId = dbFields.targetNodeId;
        this.isVisible = dbToBool(dbFields.isVisible);
        this.isRedacted = dbToBool(dbFields.isRedacted);
        this.timestamp = timestamp(dbFields.timestamp);
    }
}

class TimelineEvent {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.linkId = dbFields.linkId;
        this.message = dbFields.message;
        this.matrixEventId = dbFields.matrixEventId;
        this.timestamp = timestamp(dbFields.timestamp);
    }
}

class StateEvent {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.type = dbFields.type;
        this.linkId = dbFields.linkId;
        this.nodeId = dbFields.nodeId;
        this.nodeVersionId = dbFields.nodeVersionId;
        this.timestamp = timestamp(dbFields.timestamp);
    }
}

class CompleteNode extends Node {
    constructor(dbFields) {
        super(dbFields);

        this.currentMeta = new NodeMeta(dbFields.nodeMeta);
    }
}

class CompleteStateEvent {
    constructor(dbFields) {
        this.stateEvent = new StateEvent(dbFields);

        if (dbFields.link) this.link = new Link(dbFields.link);
        if (dbFields.node) this.node = new Node(dbFields.node);
        if (dbFields.nodeVersion) this.nodeVersion = new NodeVersion(dbFields.nodeVersion);
    }
}

class CompleteTimelineEvent {
    constructor(dbFields) {
        this.event = new StateEvent(dbFields);
        this.link = new Link(dbFields.link);
        this.sourceNode = new Node(dbFields.link.sourceNode);
        this.targetNode = new Node(dbFields.link.targetNode);
        this.sourceNodeMeta = new NodeMeta(dbFields.link.sourceNode.nodeMeta);
        this.targetNodeMeta = new NodeMeta(dbFields.link.targetNode.nodeMeta);
    }
}

class StatsContainer {
    constructor(dbFields) {
        this.rooms = dbFields.rooms;
        this.aliases = dbFields.aliases;
        this.users = dbFields.users;
        this.servers = dbFields.servers;
        this.mentions = dbFields.mentions;
    }
}

module.exports = VoyagerStore;
module.exports.models = {
    Node: Node,
    Link: Link,
    NodeVersion: NodeVersion,
    NodeMeta: NodeMeta,
    NodeAlias: NodeAlias,
    TimelineEvent: TimelineEvent,
    StateEvent: StateEvent
};