# matrix-voyager-bot

[![TravisCI badge](https://travis-ci.org/turt2live/matrix-voyager-bot.svg?branch=master)](https://travis-ci.org/turt2live/matrix-voyager-bot)
[![Targeted for next release](https://badge.waffle.io/turt2live/matrix-voyager-bot.png?label=sorted&title=Targeted+for+next+release)](https://waffle.io/turt2live/waffle-matrix?utm_source=badge)
[![WIP](https://badge.waffle.io/turt2live/matrix-voyager-bot.png?label=wip&title=WIP)](https://waffle.io/turt2live/waffle-matrix?utm_source=badge)
[![Donate on Gratipay](https://img.shields.io/gratipay/matrix-voyager.svg)](https://gratipay.com/Matrix-Voyager/)

This is a [[matrix]](https://matrix.org) bot that travels the federation simply based upon user input to rooms it participates in. 

Whenever the bot is invited to a room, or someone leaves an alias to a room in their message, the bot will try to join that room and add it to the network graph. If the bot is then kicked or banned, it removes the node from the graph.

The bot currently goes by the name of `@voyager:t2bot.io` and has its network graph published [here](https://voyager.t2bot.io/).

Questions? Ask away in [#voyager-bot:matrix.org](https://matrix.to/#/#voyager-bot:matrix.org)

# Usage

1. Invite `@voyager:t2bot.io` to a room
2. Send a message with a room alias (eg: `Hello! Please join #voyager-bot:matrix.org!`)
3. Wait a moment while the bot collects some information and joins the room

# Building your own

*Note*: You'll need to have access to an account that the bot can use to get the access token.

1. Clone this repository
2. `npm install`
3. Copy `config/default.yaml` to `config/production.yaml`
4. Edit the values of `config/production.yaml` and `config/database.json` to match your needs
5. Run the bot with `NODE_ENV=production node index.js`

# But... why?

There's no real benefit to having this bot in the room, seeing as it just listens and joins other rooms. This is not intended to be a functional bot - just a fun project that builds a pretty graph.

# How to remove the bot from a room

There are 2 options to remove the bot from the room:
1. Kick it (someone can still invite it back or relink an alias of the room)
2. Ban it (if you'd like it to stay gone)

The bot does record who kicked/banned it and what the reason given was. The bot will remove any applicable nodes from the graph.

