import { Injectable } from "@angular/core";
import { PaginatedVoyagerNetwork } from "./voyager-network";
import { Http, Response } from "@angular/http";
import { Observable } from "rxjs";

@Injectable()
export class ApiService {
    constructor(private http: Http) {
    }

    getNetwork(since = 0, limit = 10000): Observable<PaginatedVoyagerNetwork> {
        return this.http.get("/api/v1/network", {params: {since: since, limit: limit}})
            .map(this.extractData)
            .catch(this.handleError);
    }

    private extractData(res: Response) {
        let body = res.json();
        return body || {};
    }

    private handleError(error: Response|any) {
        let errMsg: string;
        if (error instanceof Response) {
            const body = error.json() || '';
            const err = body.error || JSON.stringify(body);
            errMsg = `${error.status} - ${error.statusText || ''} ${err}`;
        } else {
            errMsg = error.message ? error.message : error.toString();
        }
        console.error(errMsg);
        return Observable.throw(errMsg);
    }
}

