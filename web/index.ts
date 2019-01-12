import "./polyfills";
import { enableProdMode } from "@angular/core";
import { platformBrowserDynamic } from "@angular/platform-browser-dynamic";
import { AppModule } from "./app/app.module";

// depending on the env mode, enable prod mode or add debugging modules
//noinspection TypeScriptUnresolvedVariable
if (process.env.ENV === "build") {
    enableProdMode();
}

console.log("Bootstrapping app");
platformBrowserDynamic().bootstrapModule(AppModule);