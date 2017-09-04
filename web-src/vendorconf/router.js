import Vue from "vue";
import Router from "vue-router";
import Graph from "@/components/graph/graph";
import Stats from "@/components/stats/stats";

Vue.use(Router);

export default new Router({
    routes: [
        {
            path: '/',
            name: 'Graph',
            component: Graph
        },
        {
            path: '/stats',
            name: 'Stats',
            component: Stats
        }
    ]
});
