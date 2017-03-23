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
        this._app.get('/api/v1/thumbnail/:type/:item', this._getThumbnail.bind(this));
    }

    listen() {
        this._app.listen(config.get('web.port'), config.get('web.address'));
        log.info("WebHandler", "Listening on port " + config.get('web.address') + ":" + config.get('web.port'));
    }

    _getThumbnail(request, response) {
        this._matrix.getThumbnail(request.params.item, request.params.type).then(thumb=> {
            response.end(thumb, 'binary');
        }, () => {
            this._generateThumbnail(request.params.item, request.params.type).then(thumb=> {
                response.end(thumb, 'binary');
            }, () => response.sendStatus(404));
        });
    }

    _generateThumbnail(seed, type) {
        var hash = stringHash(seed);
        var knownColors = [
            {red: 174, green: 113, blue: 198, alpha: 255},
            {red: 113, green: 198, blue: 168, alpha: 255},
            {red: 198, green: 168, blue: 113, alpha: 255},
            {red: 113, green: 137, blue: 198, alpha: 255}
        ];
        var seedColor = knownColors[hash % knownColors.length];

        return new Promise((resolve, reject)=> {
            var fileName = (type == 'room' ? 'images/room_overlay.png' : 'images/user_overlay.png');
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

        var publicUsers = [];
        var unpublishedRoomIds = [];
        var anonMap = {};
        var anonIndex = 0; // just an incrementing value to use when anonymizing users/rooms

        var getAnonId = function (id) {
            if (anonMap[id]) return anonMap[id];
            anonMap[id] = "anon-idx-" + anonIndex++;
            return anonMap[id];
        };

        this._db.getEnrolledUsers().then(enrolledUsers => {
            publicUsers = enrolledUsers;
            return this._db.getMembershipEvents();
        }, err => {
            throw err;
        }).then(events => {
            // We have to find all rooms that should be unpublished first, so we don't show the invite node when
            // the room should be hidden.
            for (var event of events) {
                if (event.type == 'kick' || event.type == 'ban') {
                    // Skip events that we don't want to show
                    unpublishedRoomIds.push(event.room_id);
                }
            }

            for (var event of events) {
                if (unpublishedRoomIds.indexOf(event.room_id) !== -1)
                    continue; // we were kicked or banned - don't publish link

                // Add the user node
                var publicUser = publicUsers.indexOf(event.sender) !== -1;
                var userNodeId = (publicUser ? event.sender : getAnonId(event.sender)) + "-" + event.type;
                if (!nodes[userNodeId]) {
                    nodes[userNodeId] = {
                        id: userNodeId,
                        type: 'user',
                        display: publicUser ? event.sender : 'Matrix User'
                    };
                }

                // Add the room node
                var roomPublic = this._matrix.isPublicRoom(event.room_id);
                var roomNodeId = roomPublic ? event.room_id : getAnonId(event.room_id);
                var roomAlias = this._matrix.getRoomAlias(event.room_id);
                if (!nodes[roomNodeId]) {
                    nodes[roomNodeId] = {
                        id: roomNodeId,
                        type: 'room',
                        display: roomPublic ? roomAlias : 'Matrix Room'
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
                if (unpublishedRoomIds.indexOf(event.to_room_id) !== -1 || unpublishedRoomIds.indexOf(event.to_room_id) !== -1)
                    continue; // Skip room node - we were kicked or banned, so it should be unpublished

                var sourceRoomPublic = this._matrix.isPublicRoom(event.from_room_id);
                var targetRoomPublic = this._matrix.isPublicRoom(event.to_room_id);

                var sourceNodeId = sourceRoomPublic ? event.from_room_id : getAnonId(event.from_room_id);
                var targetNodeId = targetRoomPublic ? event.to_room_id : getAnonId(event.to_room_id);

                if (!targetNodeId) continue; // skip link - no target room (probably an unknown room)

                // add the nodes if they don't exist
                var sourceRoomAlias = this._matrix.getRoomAlias(event.from_room_id);
                var targetRoomAlias = this._matrix.getRoomAlias(event.to_room_id);
                if (!nodes[sourceNodeId]) {
                    nodes[sourceNodeId] = {
                        id: sourceNodeId,
                        type: 'room',
                        display: sourceRoomPublic ? sourceRoomAlias : 'Matrix Room'
                    };
                }
                if (!nodes[targetNodeId]) {
                    nodes[targetNodeId] = {
                        id: targetNodeId,
                        type: 'room',
                        display: targetRoomPublic ? targetRoomAlias : 'Matrix Room'
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