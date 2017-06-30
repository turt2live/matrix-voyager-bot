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

    // These are just to make typescript/webpack happy (copy/pasted)
    index?: number;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    fx?: number | null;
    fy?: number | null;
}

export class NetworkLink implements SimulationLinkDatum<NetworkNode> {
    sourceNode: number;
    targetNode: number;
    value: number;
    type: string;
    inverseCount: number;
    relatedLinkTypes: string[];

    // These are just to make typescript/webpack happy (copy/pasted)
    source: NetworkNode | string | number;
    target: NetworkNode | string | number;
    index?: number;
}
