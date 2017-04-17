# Voyager API Docs

*TODO: Convert this to swagger or some other proper documentation*

All resources can be reached with [https://voyager.t2bot.io](https://voyager.t2bot.io)

### Link Types
* `message` - A message in a room that contained an alias or room ID
* `topic` - A topic in the source room contained an alias or room ID
* `invite` - The bot was invited to the target room by the source user
* `self_link` - The source user decided to link themselves to the target room

**Exist, but selectively exposed by endpoints**
* `kick` - A user has kicked the bot from the room
* `ban` - A user has banned the bot from the room
* `soft_kick` - A user has asked the bot to leave peacefully (does not redact room node)

*Note:* Most endpoints do not support these extra link types. Endpoints that do will indicate as such.

### Event Types
* `node_added` - A new node has been created
* `node_updated` - An existing node has been updated, see metadata
* `node_removed` - An existing node has been removed
* `link_added` - A link has been created (may occur multiple times for each source and target pair)
* `link_removed` - An existing link has been removed
 
## `GET /api/v1/network`

Gets information about the graph network.

**Request parameters:**
* `limit` - `int`, the number of results to retrieve (up to 10,000). Default is 1000, minimum 1.
* `since` - `long`, the timestamp to filter against. Default is the beginning of time.

**Response:**
```javascript
{
  total: 1000, // total links in this result set
  remaining: 10, // the number of results not included in this response that are after `since`
  redacted: 0, // the number of results marked as redacted (these will not be in the results)
  hidden: 0, // the number of results marked as invisible (these will not be in the results)
  results: {
    // Note: This only includes nodes that are relevant to the `links`
    nodes: [{
      id: 1234,
      firstIntroduced: 1234567890, // milliseconds since epoch
      meta: {
        type: 'user', // or 'room'
        displayName: "Some User",
        avatarUrl: "https://...", // not included if the node doesn't have an avatar
        objectId: "@user:domain.com", // Rooms will be a Room ID. Anonymous nodes don't have this.
        isAnonymous: false
      }
    }],

    // Links now all have a weight of 1 and may be duplicated (source to target). 
    links: [{
      id: 1234,
      timestamp: 1234567890, // milliseconds since epoch
      meta: {
        sourceNodeId: 1234,
        targetNodeId: 1235,
        type: 'message' // any of the normal link types
      }
    }]
  }
}
```

If there are no events/links for the given range, the following is returned as `200 OK`:
```javascript
{
  total: 0,
  remaining: 0,
  results: {
    nodes: [],
    links: []
  }
}
```

## `GET /api/v1/nodes`

Gets all known nodes (users or rooms).

**Response:**
```javascript
[{
  id: 1234,
  firstIntroduced: 1234567890 // milliseconds since epoch
  meta: {
    type: 'user', // or 'room'
    displayName: "Some User",
    avatarUrl: "https://...", // not included if the node doesn't have an avatar
    objectId: "@user:domain.com", // Rooms will be a Room ID. Anonymous nodes don't have this.
    isAnonymous: false
  }
}]
```

## `GET /api/v1/nodes/{id}`

Gets information about a particular node

**Response:**
```javascript
{
  id: 1234,
  firstIntroduced: 1234567890 // milliseconds since epoch
  meta: {
    type: 'user', // or 'room'
    displayName: "Some User",
    avatarUrl: "https://...", // not included if the node doesn't have an avatar
    objectId: "@user:domain.com", // Rooms will be a Room ID. Anonymous nodes don't have this.
    isAnonymous: false
  }
}
```

If the node is not found, `404 Not Found` is returned.

## `GET /api/v1/events`

Gets all known events. This will include state events for the 'extra' link types.

**Request Query Params**
* `limit` - `int`, the number of results to retrieve (up to 10,000). Default is 1000, minimum 1.
* `since` - `long`, the timestamp to filter against. Default is the beginning of time.

**Response:**
```javascript
{
  total: 1000,
  remaining: 10, // the number of results not included in this response that are after `since`
  results: {
    events: [{
      id: 1234, // an ID for this event (sequential to dedupe timestamp)
      type: "node_updated", // any of the event types available
      timestamp: 1234567890, // milliseconds since epoch
      nodeId: 1234,
      meta: { // may not be included if it doesn't apply to the event, or if the relevant node no longer exists
        displayName: 'Some Name',
        avatarUrl: 'https://...',
        isAnonymous: false
      }
    }]
  }
}
```

If no events were found for the given range, the following is returned as `200 OK`:
```javascript
{
  total: 0,
  remaining: 0,
  results: {
    events: []
  }
}
```

### Some examples of other event types

**node_added**
```javascript
{
  id: 1234,
  type: "node_added",
  timestamp: 1234567890, // milliseconds since epoch
  nodeId: 1234,
  meta: { // Not present if the node no longer exists on the graph
    displayName: 'Some Name',
    avatarUrl: 'https://...',
    isAnonymous: false,
    type: 'room', // or 'user'
    objectId: '!room:domain.com' // only present if not anonymous
  }
}
```

**node_updated**
```javascript
{
  id: 1234,
  type: "node_updated",
  timestamp: 1234567890, // milliseconds since epoch
  nodeId: 1234,
  meta: { // Not present if the node no longer exists on the graph
    // One or more of these fields will be present, depending on the change
    displayName: 'Some Name',
    avatarUrl: 'https://...',
    isAnonymous: false
  }
}
```

**node_removed**
```javascript
{
  id: 1234,
  type: "node_removed",
  timestamp: 1234567890, // milliseconds since epoch
  nodeId: 1234
}
```

**link_added**
```javascript
{
  id: 1234,
  type: "link_added",
  timestamp: 1234567890, // milliseconds since epoch
  linkId: 1234,
  meta: {
    sourceNodeId: 1234,
    targetNodeId: 1235,
    type: 'message' // any of the link types
  }
}
```

**link_removed**
```javascript
{
  id: 1234,
  type: "link_removed",
  timestamp: 1234567890, // milliseconds since epoch
  linkId: 1234,
  meta: {
    sourceNodeId: 1234,
    targetNodeId: 1235,
    type: 'message' // any of the link types
  }
}
```