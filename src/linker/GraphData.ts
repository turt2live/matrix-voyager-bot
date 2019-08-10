import { PostgresDatabase } from "../db/postgres";
import { IRoomLink, TABLE_ROOM_LINKS } from "../db/models/RoomLink";
import * as sha1 from "hash.js/lib/hash/sha/1";
import { ICurrentRoomSnapshot, TABLE_CURRENT_ROOM_SNAPSHOTS } from "../db/models/RoomSnapshot";
import { getAvatarUrl } from "../util";
import { AvatarCache } from "../AvatarCache";
import { ICreateLink } from "../mq/consts";
import { LogService } from "matrix-js-snippets";

export interface ICondensedGraphData {
    nodes: IGraphNode[];
    edges: IGraphEdge[];
}

export interface IGraphNode {
    id: string;
    kind: "user" | "room";
    friendlyId: string;
    displayName: string;
    avatarUrl: string;
    isPublic: boolean;
    numUsers?: number;
    numServers?: number;
    numAliases?: number;
    edgeStats: {
        inbound: {
            message: number;
            invite: number;
        };
        outbound: {
            message: number;
            invite: number;
        };
    };
}

export interface IGraphEdge {
    fromId: string;
    toId: string;
    count: number;
    kind: "message" | "invite";
}

interface INodes {
    [id: string]: IGraphNode;
}

interface IEdges {
    byFromId: { [id: string]: IGraphEdge[] };
    byToId: { [id: string]: IGraphEdge[] };
}

export class GraphData {

    private objectIds: { [realId: string]: string } = {};
    private nodes: INodes = {};
    private edges: IEdges = {byFromId: {}, byToId: {}};
    private cachedCondensed: ICondensedGraphData;
    private redactedNodeIds: string[] = [];

    constructor(private db: PostgresDatabase) {
    }

    public async loadData() {
        const links = await this.db.selectAll<IRoomLink>(TABLE_ROOM_LINKS);
        LogService.info("GraphData#init", `Loaded ${links.length} links from the database`);

        const roughNodes: { [id: string]: { kind: string, links: { from: IRoomLink[], to: IRoomLink[] } } } = {};
        const redactedNodeIds: string[] = [];
        const filteredLinks: IRoomLink[] = [];

        // Do an initial pass of all the links to discover the rough nodes
        // and which nodes we'll need to redact
        for (const link of links) {
            if (link.kind === "ban" || link.kind === "kick") {
                // 'from' will be a user, 'to' will be a room
                if (redactedNodeIds.indexOf(link.to_id) === -1) {
                    redactedNodeIds.push(link.to_id);
                }
                continue;
            }
            if (link.kind !== "message" && link.kind !== "invite") {
                LogService.info("GraphData#init", `Skipping handling of link type ${link.kind}`);
                continue;
            }

            if (!roughNodes[link.from_id]) {
                roughNodes[link.from_id] = {
                    kind: link.from_type,
                    links: {from: [], to: []},
                };
            }

            if (!roughNodes[link.to_id]) {
                roughNodes[link.to_id] = {
                    kind: link.to_type,
                    links: {from: [], to: []},
                };
            }

            roughNodes[link.from_id].links.from.push(link);
            roughNodes[link.to_id].links.to.push(link);
            filteredLinks.push(link);
        }

        // Redact anything that should be redacted
        for (const nodeId of redactedNodeIds) {
            LogService.info("GraphData#init", `Redacting ${nodeId}`);
            delete roughNodes[nodeId];
        }

        // Get snapshots for all the rooms
        const roomIds = Object.keys(roughNodes).filter(i => roughNodes[i].kind === "room");
        let roomSnapshots: ICurrentRoomSnapshot[] = [];
        if (roomIds.length) {
            const whereCondition = roomIds.map((_, i) => `room_id=$${i + 1}`).join(" OR ");
            roomSnapshots = await this.db.query<ICurrentRoomSnapshot>(`SELECT * FROM ${TABLE_CURRENT_ROOM_SNAPSHOTS} WHERE ${whereCondition}`, roomIds);
        }

        // Calculate the nodes
        const finalNodes: INodes = {};
        for (const snapshot of roomSnapshots) {
            const node: IGraphNode = {
                id: snapshot.room_id,
                kind: "room",
                friendlyId: snapshot.friendly_id,
                isPublic: snapshot.is_public,
                displayName: snapshot.display_name,
                avatarUrl: getAvatarUrl(snapshot.avatar_mxc),
                numUsers: snapshot.num_users,
                numServers: snapshot.num_servers,
                numAliases: snapshot.num_aliases,
                edgeStats: {
                    inbound: {message: 0, invite: 0},
                    outbound: {message: 0, invite: 0},
                },
            };

            if (!node.isPublic) {
                node.friendlyId = "redacted";
                node.displayName = "Matrix Room";
                node.avatarUrl = getAvatarUrl(await AvatarCache.getMxcForItem("Room"));
            }

            const roughNode = roughNodes[node.id];
            if (!roughNode) continue; // shouldn't happen
            node.edgeStats.inbound.invite = roughNode.links.to.filter(e => e.kind === "invite").length;
            node.edgeStats.inbound.message = roughNode.links.to.filter(e => e.kind === "message").length;
            node.edgeStats.outbound.invite = roughNode.links.from.filter(e => e.kind === "invite").length;
            node.edgeStats.outbound.message = roughNode.links.from.filter(e => e.kind === "message").length;

            finalNodes[node.id] = node;
        }

        // Create the nodes that don't have snapshots
        const nodesWithoutSnapshots = roomIds.filter(r => !roomSnapshots.find(s => s.room_id === r));
        for (const roomId of nodesWithoutSnapshots) {
            const node = finalNodes[roomId] = {
                id: roomId,
                kind: "room",
                friendlyId: "redacted",
                isPublic: false,
                displayName: "Matrix Room",
                avatarUrl: getAvatarUrl(await AvatarCache.getMxcForItem("Room")),
                numUsers: 0,
                numServers: 0,
                numAliases: 0,
                edgeStats: {
                    inbound: {message: 0, invite: 0},
                    outbound: {message: 0, invite: 0},
                },
            };

            const roughNode = roughNodes[node.id];
            if (!roughNode) continue; // shouldn't happen
            node.edgeStats.inbound.invite = roughNode.links.to.filter(e => e.kind === "invite").length;
            node.edgeStats.inbound.message = roughNode.links.to.filter(e => e.kind === "message").length;
            node.edgeStats.outbound.invite = roughNode.links.from.filter(e => e.kind === "invite").length;
            node.edgeStats.outbound.message = roughNode.links.from.filter(e => e.kind === "message").length;
        }

        LogService.info("GraphData#init", `Created ${Object.keys(finalNodes).length} nodes`);

        const tryAddUserNode = async (userId: string) => {
            if (finalNodes[userId]) return;

            const roughNode = roughNodes[userId];
            finalNodes[userId] = {
                id: userId,
                kind: "user",
                friendlyId: "redacted",
                isPublic: false,
                displayName: "Matrix User",
                avatarUrl: getAvatarUrl(await AvatarCache.getMxcForItem("User")),
                edgeStats: {
                    inbound: {
                        invite: roughNode ? roughNode.links.to.filter(e => e.kind === "invite").length : 0,
                        message: roughNode ? roughNode.links.to.filter(e => e.kind === "message").length : 0,
                    },
                    outbound: {
                        invite: roughNode ? roughNode.links.from.filter(e => e.kind === "invite").length : 0,
                        message: roughNode ? roughNode.links.from.filter(e => e.kind === "message").length : 0,
                    },
                },
            };
            LogService.info("GraphData#init", `Created user node for ${userId}`);
        };

        // Calculate edges in terms of unique counts
        const roughEdges: { [edgeId: string]: IGraphEdge } = {};
        for (const link of filteredLinks) {
            const key = `${link.from_id}::${link.to_id}::${link.kind}`;
            if (!roughEdges[key]) roughEdges[key] = {
                fromId: link.from_id,
                toId: link.to_id,
                count: 0,
                kind: <"message" | "invite">link.kind,
            };

            roughEdges[key].count++;

            if (link.from_type === "user") await tryAddUserNode(link.from_id);
            if (link.to_type === "user") await tryAddUserNode(link.to_id);
        }

        // Convert the rough edges into final edges
        const finalEdges: IEdges = {byToId: {}, byFromId: {}};
        for (const edgeId of Object.keys(roughEdges)) {
            const edge = roughEdges[edgeId];

            if (!finalEdges.byFromId[edge.fromId]) finalEdges.byFromId[edge.fromId] = [];
            finalEdges.byFromId[edge.fromId].push(edge);

            if (!finalEdges.byToId[edge.toId]) finalEdges.byToId[edge.toId] = [];
            finalEdges.byToId[edge.toId].push(edge);
        }
        LogService.info("GraphData#init", `Created ${Object.keys(finalEdges.byFromId).length} from edges`);
        LogService.info("GraphData#init", `Created ${Object.keys(finalEdges.byToId).length} to edges`);

        // Finally, populate our own properties
        this.nodes = finalNodes;
        this.edges = finalEdges;
        this.redactedNodeIds = redactedNodeIds;
        this.cachedCondensed = null;

        LogService.info("GraphData#init", "Cleared condensed cache");
    }

    public async updateRoom(roomId: string) {
        LogService.info("GraphData", `Updating ${roomId}`);
        const snapshot = await this.db.selectOne<ICurrentRoomSnapshot>(TABLE_CURRENT_ROOM_SNAPSHOTS, {room_id: roomId});
        let node = this.nodes[roomId];
        if (!node) {
            LogService.info("GraphData", `Creating node for ${roomId}`);
            node = this.nodes[roomId] = {
                id: roomId,
                kind: "room",
                friendlyId: snapshot ? snapshot.friendly_id : "redacted",
                isPublic: snapshot ? snapshot.is_public : false,
                displayName: snapshot ? snapshot.display_name : "Matrix Room",
                avatarUrl: getAvatarUrl(snapshot ? snapshot.avatar_mxc : await AvatarCache.getMxcForItem("Room")),
                numUsers: snapshot ? snapshot.num_users : 0,
                numServers: snapshot ? snapshot.num_servers : 0,
                numAliases: snapshot ? snapshot.num_aliases : 0,
                edgeStats: {
                    inbound: {message: 0, invite: 0},
                    outbound: {message: 0, invite: 0},
                },
            };
        }

        if (!snapshot || !snapshot.is_public) {
            LogService.info("GraphData", `Redacting ${roomId} by hand`);
            node.friendlyId = "redacted";
            node.displayName = "Matrix Room";
            node.avatarUrl = getAvatarUrl(await AvatarCache.getMxcForItem("Room"));
        } else if (snapshot && snapshot.is_public) {
            LogService.info("GraphData", `Reviving ${roomId} by hand`);
            node.friendlyId = snapshot.friendly_id;
            node.displayName = snapshot.display_name;
            node.avatarUrl = getAvatarUrl(snapshot.avatar_mxc);
        }

        node.isPublic = snapshot ? snapshot.is_public : false;
        node.numUsers = snapshot ? snapshot.num_users : 0;
        node.numServers = snapshot ? snapshot.num_servers : 0;
        node.numAliases = snapshot ? snapshot.num_aliases : 0;
        this.cachedCondensed = null;

        LogService.info("GraphData", "Cleared condensed cache");
    }

    public async redactRoom(roomId: string) {
        LogService.info("GraphData", `Redacting ${roomId}`);
        let node = this.nodes[roomId];
        if (!node) {
            LogService.info("GraphData", `Creating node for ${roomId}`);
            node = this.nodes[roomId] = {
                id: roomId,
                kind: "room",
                friendlyId: "redacted",
                isPublic: false,
                displayName: "Matrix Room",
                avatarUrl: getAvatarUrl(await AvatarCache.getMxcForItem("Room")),
                numUsers: 0,
                numServers: 0,
                numAliases: 0,
                edgeStats: {
                    inbound: {message: 0, invite: 0},
                    outbound: {message: 0, invite: 0},
                },
            };
        }

        node.friendlyId = "redacted";
        node.displayName = "Matrix Room";
        node.avatarUrl = getAvatarUrl(await AvatarCache.getMxcForItem("Room"));
        if (this.redactedNodeIds.indexOf(roomId) === -1) this.redactedNodeIds.push(roomId);
        this.cachedCondensed = null;

        LogService.info("GraphData", "Cleared condensed cache");
    }

    public async handleLink(link: ICreateLink) {
        LogService.info("GraphData", `Handling link of type ${link.type} from ${link.from.id} to ${link.to.id}`);
        if (this.redactedNodeIds.indexOf(link.from.id) !== -1) {
            LogService.info("GraphData", `Skipping link for ${link.from.id} - node is redacted`);
            return;
        }
        if (this.redactedNodeIds.indexOf(link.to.id) !== -1) {
            LogService.info("GraphData", `Skipping link for ${link.to.id} - node is redacted`);
            return;
        }
        if (link.type === "ban" || link.type === "kick") {
            return this.redactRoom(link.to.id);
        }
        if (link.type !== "invite" && link.type !== "message") {
            return;
        }

        const fromNode = await this.createLiveNode(link.from.type, link.from.id);
        const toNode = await this.createLiveNode(link.to.type, link.to.id);

        fromNode.edgeStats.outbound[link.type]++;
        toNode.edgeStats.inbound[link.type]++;

        if (!this.edges.byFromId[fromNode.id]) this.edges.byFromId[fromNode.id] = [];
        if (!this.edges.byToId[toNode.id]) this.edges.byToId[toNode.id] = [];

        let fromEdge = this.edges.byFromId[fromNode.id].find(e => e.kind === link.type && e.toId === toNode.id);
        let toEdge = this.edges.byToId[toNode.id].find(e => e.kind === link.type && e.fromId === fromNode.id);
        if (fromEdge !== toEdge || !fromEdge) {
            if (fromEdge !== toEdge) {
                LogService.warn("GraphData", `Edge ${link.type} from ${fromNode.id} to ${toNode.id} does not match in both directions - using maximum`);
            }

            const fromIdx = this.edges.byFromId[fromNode.id].indexOf(fromEdge);
            const toIdx = this.edges.byToId[toNode.id].indexOf(toEdge);
            if (fromIdx !== -1) this.edges.byFromId[fromNode.id].splice(fromIdx, 1);
            if (toIdx !== -1) this.edges.byToId[toNode.id].splice(toIdx, 1);

            LogService.info("GraphData", `Creating new edge of type ${link.type} from ${fromNode.id} to ${toNode.id}`);
            const newEdge: IGraphEdge = {
                fromId: fromNode.id,
                toId: toNode.id,
                kind: link.type,
                count: Math.max(fromEdge ? fromEdge.count : 0, toEdge ? toEdge.count : 0),
            };
            this.edges.byFromId[fromNode.id].push(newEdge);
            this.edges.byToId[toNode.id].push(newEdge);
            fromEdge = newEdge;
        }

        LogService.info("GraphData", `Incrementing edge of type ${fromEdge.kind}`);
        fromEdge.count++;
        this.cachedCondensed = null;

        LogService.info("GraphData", "Cleared condensed cache");
    }

    private async createLiveNode(kind: "user" | "room", id: string): Promise<IGraphNode> {
        if (this.nodes[id]) return this.nodes[id];

        if (kind === "user") {
            LogService.info("GraphData", `Creating live user node for ${id}`);
            this.nodes[id] = {
                id: id,
                kind: "user",
                friendlyId: "redacted",
                isPublic: false,
                displayName: "Matrix User",
                avatarUrl: getAvatarUrl(await AvatarCache.getMxcForItem("User")),
                edgeStats: {
                    inbound: {invite: 0, message: 0},
                    outbound: {invite: 0, message: 0},
                },
            };
        } else if (kind === "room") {
            LogService.info("GraphData", `Creating live room node for ${id}`);
            await this.updateRoom(id);
            return this.nodes[id];
        } else {
            throw new Error("Unrecognized type: " + kind);
        }
    }

    private upsertId(realId: string): string {
        if (!this.objectIds[realId]) {
            this.objectIds[realId] = sha1().update(realId).digest('hex');
        }
        return this.objectIds[realId];
    }

    public condense(): ICondensedGraphData {
        if (this.cachedCondensed) return this.cachedCondensed;
        LogService.info("GraphData", "Generating new condensed graph data");

        const data: ICondensedGraphData = {nodes: [], edges: []};

        for (const nodeId of Object.keys(this.nodes)) {
            const node: IGraphNode = JSON.parse(JSON.stringify(this.nodes[nodeId]));
            node.id = this.upsertId(node.id);
            data.nodes.push(node);
        }

        for (const nodeId of Object.keys(this.edges.byFromId)) {
            const nodeEdges: IGraphEdge[] = JSON.parse(JSON.stringify(this.edges.byFromId[nodeId]));
            for (const edge of nodeEdges) {
                edge.toId = this.upsertId(edge.toId);
                edge.fromId = this.upsertId(edge.fromId);
                data.edges.push(edge);
            }
        }

        return data;
    }
}
