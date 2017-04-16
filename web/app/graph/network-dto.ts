import { SimulationLinkDatum, SimulationNodeDatum } from "d3-ng2-service";

export class NetworkNode implements SimulationNodeDatum {
    id: number;
    name: string;
    group: string;
    type: string;
    avatarUrl: string;
    isAnonymous: boolean;
    linkCount: number;
    primaryAlias: string;
    directLinks: NetworkLink[];
}

export class NetworkLink implements SimulationLinkDatum<NetworkNode> {
    sourceNode: number;
    targetNode: number;
    source: NetworkNode;
    target: NetworkNode;
    value: number;
    type: string;
    inverseCount: number;
    relatedLinkTypes: string[];
}
