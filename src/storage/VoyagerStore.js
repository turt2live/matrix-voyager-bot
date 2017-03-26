var sqlite3 = require('sqlite3');
var DBMigrate = require("db-migrate");
var log = require("npmlog");

/**
 * Primary storage for Voyager.
 */
class VoyagerStore {

    constructor() {
        this._db = null;
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
                resolve();
            }, err => {
                log.error("VoyagerStore", err);
                reject(err);
            }).catch(err => {
                log.error("VoyagerStore", err);
                reject(err);
            });
        });
    }

    /**
     * Creates a new Node
     * @param {'user'|'room'} type the type of Node
     * @param {string} objectId the object ID for the Node
     * @param {{displayName: string, avatarUrl: string, isAnonymous: boolean}} firstVersion the first version of the Node
     * @param {boolean} isReal true if the node is a real node
     * @param {boolean} isRedacted true if the node should be redacted
     * @return {Promise<Node>} resolves to the created Node
     */
    createNode(type, objectId, firstVersion, isReal = true, isRedacted = false) {
        // Note to self: Set firstTimestamp to 0
        // Note to self: Add node_added state event
    }

    /**
     * Gets a Node from the data store
     * @param {'user'|'room} type the type of Node
     * @param {string} objectId the object ID of the Node
     * @returns {Promise<Node>} resolves to the found node, or null if not found
     */
    getNode(type, objectId) {

    }

    /**
     * Gets whether or not the given user has enrolled into being public
     * @param {string} userId the user ID to lookup
     * @returns {boolean} true if enrolled, false otherwise
     */
    isEnrolled(userId) {

    }

    /**
     * Sets whether or not the given user is enrolled in being public
     * @param {string} userId the user ID to update
     * @param {boolean} isEnrolled true to enroll, false otherwise
     * @returns {Promise} resolved when complete
     */
    setEnrolled(userId, isEnrolled) {
        // Note to self: Add appropriate StateEvent
    }

    /**
     * Creates a new Link
     * @param {Node} sourceNode the source Node
     * @param {Node} targetNode the target Node
     * @param {'invite'|'message'|'self_link'|'kick'|'ban'} type the link type
     * @param {boolean} isVisible true if the link is visible
     * @param {boolean} isRedacted true if the link should be redacted
     * @returns {Promise<Link>} resolves to the created link
     */
    createLink(sourceNode, targetNode, type, isVisible = true, isRedacted = false) {

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
        // Note to self: Update firstTimestamp on Nodes if needed
        // Note to self: Create link_added state event
    }

    /**
     * Attempts to find a given Link
     * @param {Node} sourceNode the source node
     * @param {Node} targetNode the target node
     * @param {'invite'|'message'|'self_link'|'kick'|'ban'} type the link type
     * @returns {Promise<Link>} resolves with the found link, or null
     */
    findLink(sourceNode, targetNode, type) {

    }

    /**
     * Creates a new StateEvent
     * @param {'node_added'|'node_updated'|'node_removed'|'link_added'|'link_removed'} type the event type
     * @param {Node|Link} object the Link or Node for the event
     * @param {NodeVersion} version the Node version. Only applies if the object is a Node
     * @returns {Promise<StateEvent>} resolves to the created state event
     */
    createStateEvent(type, object, version = null) {
        // Note to self: validate object for type
    }

    /**
     * Updates a node to be redacted
     * @param {Node} node the node to be redacted
     * @returns {Promise} resolves when the node has been updated
     */
    redactNode(node) {
        // Note to self: Redact node & add applicable state event(s) for orphaned links/nodes
    }

    /**
     * Updates a link to be redacted
     * @param {Link} link the link to be redacted
     * @returns {Promise} resolves when the link has been updated
     */
    redactLink(link) {
        // Note to self: Redact link & add applicable state event(s) for orphaned links/nodes
    }
}

class Node {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.type = dbFields.type;
        this.objectId = dbFields.objectId;
        this.isReal = dbFields.isReal;
        this.firstTimestamp = dbFields.firstTimestamp;
        this.isRedacted = dbFields.isRedacted;
    }
}

class NodeVersion {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.nodeId = dbFields.nodeId;
        this.previousVersionId = dbFields.previousVersionId;
        this.displayName = dbFields.displayName;
        this.avatarUrl = dbFields.avatarUrl;
        this.isAnonymous = dbFields.isAnonymous;
    }
}

class Link {
    constructor(dbFields) {
        this.id = dbFields.id;
        this.type = dbFields.type;
        this.sourceNodeId = dbFields.sourceNodeId;
        this.targetNodeId = dbFields.targetNodeId;
        this.isVisible = dbFields.isVisible;
        this.isRedacted = dbFields.isRedacted;
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