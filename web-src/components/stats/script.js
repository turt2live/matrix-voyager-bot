import StatBox from "./stat-box/stat-box.vue";

export default {
    name: 'stats',
    components: {StatBox},
    data () {
        return {
            isLoading: true,
            error: null,
            stats: {
                rooms: 2575,
                users: 250123,
                aliases: 4123,
                mentions: 10000,
                servers: 24576
            }
        };
    },
    mounted () {
        this.$http.get('/api/v1/stats').then(response => {
            this.stats = response.body;
            this.isLoading = false;
        }).catch(error => {
            this.error = "There was a problem loading the data. Please try again later.";
            this.isLoading = false;
            console.error(error);
        });
    },
    methods: {}
};
