import { NgModule, ApplicationRef } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";
import { HttpModule } from "@angular/http";
import { FormsModule } from "@angular/forms";
import { AppComponent } from "./app.component";
import { HomeComponent } from "./home/home.component";
import { GraphComponent } from "./graph/graph.component";
import { GraphDialogComponent } from "./graph/graph-dialog/graph-dialog.component";
import { ApiService } from "./shared";
import { routing } from "./app.routing";
import { removeNgStyles, createNewHosts } from "@angularclass/hmr";
import { D3Service } from "d3-ng2-service";
import { NgbModule } from "@ng-bootstrap/ng-bootstrap";

@NgModule({
    imports: [
        BrowserModule,
        HttpModule,
        FormsModule,
        routing,
        NgbModule.forRoot()
    ],
    declarations: [
        AppComponent,
        HomeComponent,
        GraphDialogComponent,
        GraphComponent
    ],
    providers: [
        ApiService,
        D3Service
    ],
    bootstrap: [AppComponent],
    entryComponents: [GraphDialogComponent]
})
export class AppModule {
    constructor(public appRef: ApplicationRef) {
    }

    hmrOnInit(store) {
        console.log('HMR store', store);
    }

    hmrOnDestroy(store) {
        let cmpLocation = this.appRef.components.map(cmp => cmp.location.nativeElement);
        // recreate elements
        store.disposeOldHosts = createNewHosts(cmpLocation);
        // remove styles
        removeNgStyles();
    }

    hmrAfterDestroy(store) {
        // display new elements
        store.disposeOldHosts();
        delete store.disposeOldHosts;
    }
}
