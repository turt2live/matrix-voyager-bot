import { NgModule, ApplicationRef } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";
import { HttpModule } from "@angular/http";
import { FormsModule } from "@angular/forms";
import { AppComponent } from "./app.component";
import { HomeComponent } from "./home/home.component";
import { GraphComponent } from "./graph/graph.component";
import { ApiService } from "./shared";
import { routing } from "./app.routing";
import { removeNgStyles, createNewHosts } from "@angularclass/hmr";
import { D3Service } from "d3-ng2-service";

@NgModule({
    imports: [
        BrowserModule,
        HttpModule,
        FormsModule,
        routing
    ],
    declarations: [
        AppComponent,
        HomeComponent,
        GraphComponent
    ],
    providers: [
        ApiService,
        D3Service
    ],
    bootstrap: [AppComponent]
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
