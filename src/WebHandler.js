var express = require("express");
var log = require("npmlog");
var config = require("config");
var PNGImage = require("pngjs-image");
var stringHash = require("string-hash");

class WebHandler {
    constructor(db, matrix) {
        this._db = db;
        this._matrix = matrix;
        this._app = express();

        this._app.use(express.static('app'));

        this._app.get('/api/v1/network', this._getNetwork.bind(this));
        this._app.get('/api/v1/thumbnail/:item', this._getThumbnail.bind(this));
    }

    listen() {
        this._app.listen(config.get('web.port'), config.get('web.address'));
        log.info("WebHandler", "Listening on port " + config.get('web.address') + ":" + config.get('web.port'));
    }

    _getThumbnail(request, response) {
        this._matrix.getThumbnail(request.params.item).then(thumb=> {
            response.end(thumb, 'binary');
        }, () => {
            this._generateThumbnail(request.params.item).then(thumb=> {
                response.end(thumb, 'binary');
            }, () => response.sendStatus(404));
        });
    }

    _generateThumbnail(seed) {
        var hash = stringHash(seed);
        var knownColors = [
            {red: 174, green: 113, blue: 198, alpha: 255},
            {red: 113, green: 198, blue: 168, alpha: 255},
            {red: 198, green: 168, blue: 113, alpha: 255},
            {red: 113, green: 137, blue: 198, alpha: 255}
        ];
        var seedColor = knownColors[hash % knownColors.length];

        return new Promise((resolve, reject)=> {
            var fileName = (seed[0] == '!' || seed[0] == '#' ? 'images/room_overlay.png' : (seed[0] == '@' ? 'images/user_overlay.png' : null));
            var overlay = null;

            try {
                if (fileName != null) overlay = PNGImage.readImageSync(fileName);
            } catch (e) {
                log.warn("WebHandler", e);
            }

            var image = PNGImage.createImage(150, 150);
            image.fillRect(0, 0, 150, 150, seedColor);

            if (overlay) {
                for (var x = 0; x < 150; x++) {
                    for (var y = 0; y < 150; y++) {
                        var idx = overlay.getIndex(x, y);
                        var red = overlay.getRed(idx);
                        var green = overlay.getGreen(idx);
                        var blue = overlay.getBlue(idx);
                        var alpha = overlay.getAlpha(idx);
                        if (alpha > 0) {
                            image.setPixel(x, y, {
                                red: red,
                                green: green,
                                blue: blue,
                                alpha: alpha
                            });
                        }
                    }
                }
            }

            image.toBlob(function (err, data) {
                if (err) reject(err);
                else resolve(data);
            });
        });
    }

    _getNetwork(request, response) {
        var nodes = {}; // { id: node }
        var links = {}; // { id: link }

        this._db.getMembershipEvents().then(events => {
            for (var event of events) {
                // Add the user node
                var userNodeId = event.sender + "-" + event.type;
                if (!nodes[userNodeId]) {
                    nodes[userNodeId] = {
                        id: userNodeId,
                        type: 'user',
                        display: event.sender
                    };
                }

                // Add the room node
                var roomNodeId = event.room_id;
                var roomAlias = this._matrix.getRoomAlias(event.room_id);
                if (!nodes[roomNodeId]) {
                    nodes[roomNodeId] = {
                        id: roomNodeId,
                        type: 'room',
                        display: roomAlias
                    };
                }

                // Add the link
                var linkId = userNodeId + "-" + roomNodeId; // @user:domain.com-invite-!room:domain.com
                if (links[linkId]) {
                    links[linkId].value++;
                } else {
                    links[linkId] = {
                        source: userNodeId,
                        target: roomNodeId,
                        value: 1,
                        type: event.type
                    };
                }
            }

            // Now fetch room events and process those
            return this._db.getRoomEvents();
        }, err => {
            throw err;
        }).then(events => {
            for (var event of events) {
                var sourceNodeId = event.from_room_id;
                var targetNodeId = event.to_room_id;

                if (!targetNodeId) continue; // skip link - no target room (probably an unknown room)

                // add the nodes if they don't exist
                var sourceRoomAlias = this._matrix.getRoomAlias(event.from_room_id);
                var targetRoomAlias = this._matrix.getRoomAlias(event.to_room_id);
                if (!nodes[sourceNodeId]) {
                    nodes[sourceNodeId] = {
                        id: sourceNodeId,
                        type: 'room',
                        display: sourceRoomAlias
                    };
                }
                if (!nodes[targetNodeId]) {
                    nodes[targetNodeId] = {
                        id: targetNodeId,
                        type: 'room',
                        display: targetRoomAlias
                    };
                }

                // create the message link
                var linkId = sourceNodeId + '-' + targetNodeId;
                var altLinkId = targetNodeId + '-' + sourceNodeId;
                if (!links[linkId] && !links[altLinkId]) {
                    links[linkId] = {
                        source: sourceNodeId,
                        target: targetNodeId,
                        value: 1,
                        type: 'message'
                    };
                } else {
                    var link = links[linkId] || links[altLinkId];
                    link.value++;
                }
            }
        }, err => {
            throw err;
        }).then(() => {
            // Now that we've processed membership and room events, we need to build the actual json graph
            var result = {
                nodes: [],
                links: []
            };

            for (var nodeId in nodes) {
                result.nodes.push(nodes[nodeId]);
            }

            for (var linkId in links) {
                result.links.push(links[linkId]);
            }

            response.setHeader("Content-Type", "application/json");
            response.send(JSON.stringify(result));
        }).catch(err=> {
            log.error("WebHander", err);
            response.sendStatus(500)
        });
    }
}

module.exports = WebHandler;