import StatBox from "./stat-box/stat-box.vue";
import SortIcon from "./sort-icon/sort-icon.vue";

export default {
    name: 'stats',
    components: {StatBox, SortIcon},
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
            sortBy: "id",
            sortDir: "natural",
            rooms: [],
            seenRooms: JSON.parse(localStorage.getItem("t2l-voyager.seenNodes") || "[]")
        };
    },
    computed: {
        sortedRooms: function() {
            var getProp = (item, prop) => {
                if (prop === "name") return item.meta.displayName;
                if (prop === "alias") return item.meta.primaryAlias;
                if (prop === "users") return item.meta.stats.users;
                if (prop === "servers") return item.meta.stats.servers;
                if (prop === "aliases") return item.meta.stats.aliases;
                if (prop === "id") return item.id;
                return item[prop];
            };

            return this.rooms.sort((a, b) => {
                var order = 0;
                if (getProp(a, this.sortBy) < getProp(b, this.sortBy)) order = -1;
                if (getProp(a, this.sortBy) > getProp(b, this.sortBy)) order = 1;

                return this.sortDir === "asc" ? order : -order;
            });
        }
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
            if (this.seenRooms.length === 0) return false;
            return this.seenRooms.indexOf(item.id) === -1;
        },
        setSort (column) {
            if (this.sortBy !== column) {
                this.sortBy = column;
                this.sortDir = "asc";
            } else {
                if (this.sortDir === "asc") this.sortDir = "desc";
                else if (this.sortDir === "desc") this.sortDir = "natural";
                else if (this.sortDir === "natural") this.sortDir = "asc";
            }

            if (this.sortDir === "natural")
                this.sortBy = 'id';
        }
    }
};
