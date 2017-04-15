# Migrating from sqlite3 to postgres

1. Copy `config/database.json` to `config/database-orig.json`
2. Edit `config/database.json` to be the 'new' database settings
3. Edit `config/database-orig.json` to be the 'old' database settings
4. Run `NODE_ENV=production node migratedb.js config/database-orig.json config/database.json` (assuming you're migrating your `production` database)
   * This might take a while depending on the size of your database. 
5. Run the bot normally