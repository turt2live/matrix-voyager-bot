import "core-js/client/shim";
import 'core-js/es6/reflect';
import 'core-js/es7/reflect';
import "reflect-metadata";
import "ts-helpers";
require("zone.js/dist/zone");

//noinspection TypeScriptUnresolvedVariable
if (process.env.ENV === "build") {
    // Production

} else {
    // Development

    Error["stackTraceLimit"] = Infinity;
}
