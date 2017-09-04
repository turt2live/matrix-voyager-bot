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
            },
            rooms: [],
            seenRooms: JSON.parse(localStorage.getItem("t2l-voyager.seenNodes") || "[]")
        };
    },
    mounted () {
        this.$http.get('/api/v1/stats').then(response => {
            this.stats = response.body;
            return this.$http.get('/api/v1/nodes/publicRooms');
        }).then(response => {
            this.rooms = response.body;
            this.isLoading = false;

            var ids = [];
            for (var room of this.rooms) {
                ids.push(room.id);
            }
            localStorage.setItem("t2l-voyager.seenNodes", JSON.stringify(ids));
        }).catch(error => {
            this.error = "There was a problem loading the data. Please try again later.";
            this.isLoading = false;
            console.error(error);
        });
    },
    methods: {
        isNew (item) {
            return this.seenRooms.indexOf(item.id) === -1;
        }
    }
};
