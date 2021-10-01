var DBMigrate = require("db-migrate");
var log = require("./src/LogService");
var Sequelize = require('sequelize');
var DbModels = require("./src/storage/VoyagerStore").models;

var args = process.argv.slice(2);
if (args.length !== 2) {
    log.error("migratedb", "Missing source and/or target configuration");
    process.exit(1);
}

var sourceDbConfig = require("./" + args[0]);
var targetDbConfig = require("./" + args[1]);

var env = process.env.NODE_ENV || 'development';

var sourceDbConfigEnv = sourceDbConfig[env];
var targetDbConfigEnv = targetDbConfig[env];

function setupOrm(configPath, dbConfigEnv) {
    var driverMap = {
        // 'sqlite3': 'sqlite',
        'pg': 'postgres'
    };
    process.env.VOYAGER_DB_CONF_MIGRATE = "../" + configPath;
    var dbMigrate = DBMigrate.getInstance(true, {
        config: configPath,
        env: env
    });
    return dbMigrate.up().then(() => {
        var opts = {
            host: dbConfigEnv.host || 'localhost',
            dialect: driverMap[dbConfigEnv.driver],
            pool: {
                max: 5,
                min: 0,
                idle: 10000
            },
            logging: i => log.info("migratedb [SQL: " + configPath + "]", i)
        };

        if (opts.dialect == 'sqlite')
            opts.storage = dbConfigEnv.filename;

        return new Sequelize(dbConfigEnv.database || 'voyager', dbConfigEnv.username, dbConfigEnv.password, opts);
    });
}

function bindModels(orm) {
    var models = {};
    models.Links = orm.import(__dirname + "/src/storage/models/links");
    models.NodeVersions = orm.import(__dirname + "/src/storage/models/node_versions");
    models.Nodes = orm.import(__dirname + "/src/storage/models/nodes");
    models.NodeMeta = orm.import(__dirname + "/src/storage/models/node_meta");
    models.StateEvents = orm.import(__dirname + "/src/storage/models/state_events");
    models.TimelineEvents = orm.import(__dirname + "/src/storage/models/timeline_events");
    return models;
}

function promiseIter(set, fn) {
    return new Promise((resolve, reject) => {
        var i = 0;
        var handler = () => {
            i++;
            if (i >= set.length) resolve();
            else return fn(set[i]).then(handler, reject);
        };
        fn(set[i]).then(handler, reject);
    });
}

var source = null;
var target = null;
var sourceModels = null;
var targetModels = null;

// This process is incredibly slow, however it is only intended to be run once.
setupOrm(args[0], sourceDbConfigEnv).then(orm => source = orm).then(() => sourceModels = bindModels(source)).then(() => {
    return setupOrm(args[1], targetDbConfigEnv).then(orm => target = orm).then(() => targetModels = bindModels(target));
}).then(() => {
    log.info("migratedb", "Fetching all Nodes...");
    return sourceModels.Nodes.findAll();
}).then(nodes => {
    return promiseIter(nodes.map(r => new DbModels.Node(r)), n => {
        var nodeMeta = null;
        return sourceModels.NodeMeta.findOne({where: {nodeId: n.id}})
            .then(meta => targetModels.NodeMeta.create(new DbModels.NodeMeta(meta)))
            .then(meta => {
                nodeMeta = meta;
                n.firstTimestamp = new Date(n.firstTimestamp);
                n.nodeMetaId = meta.id;
                return targetModels.Nodes.create(n);
            }).then(node => {
                nodeMeta.nodeId = node.id;
                return nodeMeta.save();
            });
    });
}).then(() => {
    log.info("migratedb", "Fetching all Links...");
    return sourceModels.Links.findAll();
}).then(links => {
    return promiseIter(links.map(r => new DbModels.Link(r)), k => {
        k.timestamp = new Date(k.timestamp);
        return targetModels.Links.create(k);
    });
}).then(() => {
    log.info("migratedb", "Fetching all Node Versions...");
    return sourceModels.NodeVersions.findAll();
}).then(versions => {
    return promiseIter(versions.map(r => new DbModels.NodeVersion(r)), v => {
        return targetModels.NodeVersions.create(v);
    });
}).then(() => {
    log.info("migratedb", "Fetching all Timeline Events...");
    return sourceModels.TimelineEvents.findAll();
}).then(events => {
    return promiseIter(events.map(r => new DbModels.TimelineEvent(r)), e => {
        e.timestamp = new Date(e.timestamp);
        return targetModels.TimelineEvents.create(e);
    });
}).then(() => {
    log.info("migratedb", "Fetching all State Events...");
    return sourceModels.StateEvents.findAll();
}).then(events => {
    return promiseIter(events.map(r => new DbModels.StateEvent(r)), e => {
        e.timestamp = new Date(e.timestamp);
        return targetModels.StateEvents.create(e);
    });
}).then(() => {
    if (targetDbConfigEnv.driver == 'pg') {
        log.info("migratedb", "Updating sequences...");
        return target.query("SELECT setval('links_id_seq', COALESCE((SELECT MAX(id)+1 FROM links), 1), false)", {type: Sequelize.QueryTypes.SELECT})
            .then(() => target.query("SELECT setval('node_versions_id_seq', COALESCE((SELECT MAX(id)+1 FROM node_versions), 1), false)", {type: Sequelize.QueryTypes.SELECT}))
            .then(() => target.query("SELECT setval('nodes_id_seq', COALESCE((SELECT MAX(id)+1 FROM nodes), 1), false)", {type: Sequelize.QueryTypes.SELECT}))
            .then(() => target.query("SELECT setval('node_meta_id_seq', COALESCE((SELECT MAX(id)+1 FROM node_meta), 1), false)", {type: Sequelize.QueryTypes.SELECT}))
            .then(() => target.query("SELECT setval('state_events_id_seq', COALESCE((SELECT MAX(id)+1 FROM state_events), 1), false)", {type: Sequelize.QueryTypes.SELECT}))
            .then(() => target.query("SELECT setval('timeline_events_id_seq', COALESCE((SELECT MAX(id)+1 FROM timeline_events), 1), false)", {type: Sequelize.QueryTypes.SELECT}))
    }
}).then(() => {
    log.info("migratedb", "Done migration. Cleaning up...");
}).catch(err => {
    log.error("migratedb", err);
    throw err;
});
