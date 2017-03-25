# Voyager API Docs

*TODO: Convert this to swagger or some other proper documentation*

All resources can be reached with [https://voyager.t2bot.io](https://voyager.t2bot.io)
 
## `GET /api/v1/network`

Returns the entire network graph for the bot, as it is currently known.

**Response:**
```javascript
{
  nodes: [{
    id: "some-unique-id-string",
    type: "user", // 'user' or 'room'
    display: 'Some User',
    isAnonymous: false,
    objectId: '@user:domain.com', // Rooms will be a room ID. If anonymous, this will be generified (@anon:t2bot.io, for example)
    firstIntroduced: 1234567890, // milliseconds since epoch, UTC
    knownLinks: ['invite', 'self_link'] // the types of links to expect for this node in the 'links' key
  }],
  links: [{
    id: "some-unique-id-string",
    type: "invite", // 'invite', 'self_link', 'message', 'tracked'
    firstIntroduced: 1234567890, // milliseconds since epoch, UTC
    target: "some-id-string",
    source: "some-id-string",
    value: 5, // number of events for this direction
    relatedLinkTypes: ['self_link'] // the other types of links going in this same direction
  }]
}
```

## `GET /api/v1/events`

Gets all known events.

**Request Query Params**
* `page` - `int`, the page number to get - defaults to `1`
* `pageSize` - `int`, the number of results per page (up to 1000) - defaults to `1000`
* `since` - `long`, the timestamp to filter against

**Response:**
```javascript
{
  results: 1000,
  page: 1,
  nextPage: null, // will be a number if more results are available, otherwise null
  events: [{
    type: "invite", // 'invite', 'self_link', 'message', 'tracked'
    timestamp: 1234567890, // milliseconds since epoch
    objectType: "user", // "user" or "room"
    objectId: "@user:domain.com", // this may be anonymized (@anon:t2bot.io, for example)
    display: "Some User",
    target: "some-object-id", // this may be anonymized (!anon:t2bot.io, for example)
    isSourceAnonymous: false,
    isTargetAnonymous: false
  }]
}
```

*Note*: The event graph is ordered by timestamp in *descending* order (so page 1 is the most recent). Use the `since` parameter to filter this output.

## `GET /api/v1/{type}/{object_id}`

Gets an avatar for a resource.

Example: `GET /api/v1/room/#voyager:t2l.io` (URL encoding not performed here).