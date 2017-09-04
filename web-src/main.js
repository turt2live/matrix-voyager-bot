// The Vue build version to load with the `import` command
// (runtime-only or standalone) has been set in webpack.base.conf with an alias.
import Vue from "vue";
import App from "./App";
import router from "./vendorconf/router";
import http from "./vendorconf/http";
import 'vue-awesome/icons';
import Icon from 'vue-awesome/components/Icon'
import numeral from 'numeral';

Vue.config.productionTip = false;

Vue.component("icon", Icon);
Vue.filter('formatNumber', (value) => {
   return numeral(value).format("0,0");
});

/* eslint-disable no-new */
new Vue({
    el: '#app',
    router,
    http,
    template: '<App/>',
    components: {App}
});

String.prototype.hashCode = function () {
    var hash = 0;
    if (this.length === 0) return hash;
    for (var i = 0; i < this.length; i++) {
        var chr = this.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};
