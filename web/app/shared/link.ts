export class Link {
    id: number;
    timestamp: number;
    meta: LinkMeta;
}

export class LinkMeta {
    type: string;
    sourceNodeId: number;
    targetNodeId: number;
    isVisible: boolean;
}
