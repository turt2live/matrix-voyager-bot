import Vue from "vue";
import Router from "vue-router";
import Graph from "@/components/graph/graph";
import Stats from "@/components/stats/stats";
import Landing from "@/components/landing/landing";

Vue.use(Router);

export default new Router({
    routes: [
        {
            path: '/',
            name: 'Landing',
            component: Landing
        },
        {
            path: '/graph',
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
