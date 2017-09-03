import { Node } from "./node";
import { Link } from "./link";

export class VoyagerNetwork {
    nodes: Node[];
    links: Link[];
}

export class PaginatedVoyagerNetwork {
    total: number;
    remaining: number;
    results: VoyagerNetwork;
}
