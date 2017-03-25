# Voyager API Docs

*TODO: Convert this to swagger or some other proper documentation*

All resources can be reached with [https://voyager.t2bot.io](https://voyager.t2bot.io)

### Event Types

* `message` - A message in a room that contained an alias or room ID
* `topic` - A topic in the source room contained an alias or room ID
* `invite` - The bot was invited to the target room by the source user
* `self_link` - The source user decided to link themselves to the target room
* `node_updated` - Shows up in a timeline when an avatar or name has been updated
* `node_removed` - Shows up in a timeline when the specified node is no longer on the graph

**Not returned from API, but still recorded:**
* `kick` - The source user kicked the bot from the target room
* `ban` - The source user banned the bot from the target room
 
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
  results: {
    // Note: This only includes nodes that are relevant to the `links`
    nodes: [{
      id: 1234,
      type: "user", // 'user' or 'room'
      displayName: 'Some User',
      isAnonymous: false,
      objectId: '@user:domain.com', // Rooms will be a Room ID. Anonymous nodes don't have this field.
      avatarUrl: 'https://t2bot.io/media/...', // Not included if the object doesn't have an avatar
      firstIntroduced: 1234567890 // milliseconds since epoch
    }],

    // Links now all have a weight of 1 and may be duplicated (source to target). 
    links: [{
      id: 1234,
      type: "invite", // any of the event types available
      timestamp: 1234567890, // milliseconds since epoch
      target: 1234,
      source: 1235
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

***Note***: `links` will never contain `node_*` events. They'll just be transparently available (or missing) in the data set returned.

## `GET /api/v1/nodes`

Gets all known nodes (users or rooms).

**Response:**
```javascript
[{
  id: 1234,
  type: "user", // 'user' or 'room'
  displayName: 'Some User',
  isAnonymous: false,
  objectId: '@user:domain.com', // Rooms will be a Room ID. Anonymous nodes don't have this field.
  avatarUrl: 'https://t2bot.io/media/...', // Not included if the object doesn't have an avatar
  firstIntroduced: 1234567890 // milliseconds since epoch
}]
```

## `GET /api/v1/nodes/{id}`

Gets information about a particular node

**Response:**
```javascript
{
  id: 1234,
  type: "user", // 'user' or 'room'
  displayName: 'Some User',
  isAnonymous: false,
  objectId: '@user:domain.com', // Rooms will be a Room ID. Anonymous nodes don't have this field.
  avatarUrl: 'https://t2bot.io/media/...', // Not included if the object doesn't have an avatar
  firstIntroduced: 1234567890 // milliseconds since epoch
}
```

If the node is not found, `404 Not Found` is returned.

## `GET /api/v1/events`

Gets all known events.

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
      type: "invite", // any of the event types available
      timestamp: 1234567890, // milliseconds since epoch
      sourceNodeId: 1235,
      targetNodeId: 1234
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

*Note*: The event graph is ordered by timestamp in *ascending* order. Use the `since` parameter to filter this output.

*Note*: The `events` may contain `node_*` events in them. They will appear as such:
```
{
  id: 1234,
  type: "node_updated",
  timestamp: 1234567890, // milliseconds since epoch
  sourceNodeId: 1234,
  targetNodeId: 1234, // always the same as source
  meta: {
    displayName: 'Some Name',
    avatarUrl: 'https://...',
    isAnonymous: false
  }
}
```
```
{
  id: 1234,
  type: "node_removed",
  timestamp: 1234567890, // milliseconds since epoch
  sourceNodeId: 1234,
  targetNodeId: 1234 // always the same as source
}
```
*Note how `node_removed` does not have any metadata information - this is because the node no longer exists.*