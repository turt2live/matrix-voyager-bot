export class Node {
    id: number;
    firstIntroduced: number;
    meta: NodeMeta;
}

export class NodeMeta {
    type: string;
    isAnonymous: boolean;
    displayName: string; // optional
    avatarUrl: string; // optional
    objectId: string; // optional
}
