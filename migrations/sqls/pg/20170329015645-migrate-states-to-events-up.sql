-- Repair database state first
delete from room_links where "timestamp" is null;

-- Find all the room nodes first
create table _room_nodes ("room_id" text, "timestamp" timestamp, "is_redacted" boolean);
insert into _room_nodes select distinct e."from_room_id", to_timestamp(0), false from room_links as e;
insert into _room_nodes select distinct e."to_room_id", to_timestamp(0), false from room_links as e where e."to_room_id" is not null and e."to_room_id" not in (select "room_id" from _room_nodes);
insert into _room_nodes select distinct e."room_id", to_timestamp(0), false from membership_events as e where e."room_id" is not null and e."room_id" not in (select _room_nodes."room_id" from _room_nodes);
update _room_nodes set "timestamp" = (select min(e."timestamp") from room_links as e where e."to_room_id" = "room_id" or e."from_room_id" = "room_id");
update _room_nodes set "timestamp" = (select min(e2."timestamp") from membership_events as e2 where e2."room_id" = _room_nodes."room_id") where _room_nodes."timestamp" > (select min(e2."timestamp") from membership_events as e2 where e2."room_id" = _room_nodes."room_id") or _room_nodes."timestamp" is null;
update _room_nodes set "is_redacted" = (select case when count(*) > 0 then true else false end from membership_events as e where e."room_id" = _room_nodes."room_id" and (e."type" = 'kick' or e."type" = 'ban'));

-- Find all the user nodes
create table _user_nodes ("user_id" text, "timestamp" timestamp, "is_redacted" boolean);
insert into _user_nodes select distinct e."sender", to_timestamp(0), false from membership_events as e;
update _user_nodes set "timestamp" = (select min(e."timestamp") from membership_events as e where e."sender" = "user_id");

-- Insert the nodes into the Nodes table
insert into nodes ("type", "objectId", "isReal", "firstTimestamp", "isRedacted") select 'room', "room_id", true, "timestamp", "is_redacted" from _room_nodes;
insert into nodes ("type", "objectId", "isReal", "firstTimestamp", "isRedacted") select 'user', "user_id", true, "timestamp", "is_redacted" from _user_nodes;

-- Clean up temporary tables
drop table _room_nodes;
drop table _user_nodes;

-- Create timeline events and links from old messages
alter table links add column "_legacy_link_id" integer;
insert into links ("type", "sourceNodeId", "targetNodeId", "timestamp", "isVisible", "isRedacted", _legacy_link_id) select 'message', (select "id" from nodes where "objectId" = e."from_room_id"), (select "id" from nodes where "objectId" = e."to_room_id"), e."timestamp", true, false, "id" from room_links as e where e."to_room_id" is not null;
insert into timeline_events ("linkId", "timestamp", "message", "matrixEventId") select links."id", (select e."timestamp" from room_links as e where e."id" = links."_legacy_link_id"), (select e."message" from room_links as e where e."id" = links."_legacy_link_id"), (select e."event_id" from room_links as e where e."id" = links."_legacy_link_id") from links;

select * from membership_events;
-- Create timeline events and links from old membership events
insert into links ("type", "sourceNodeId", "targetNodeId", "timestamp", "isVisible", "isRedacted", _legacy_link_id) select e."type", (select "id" from nodes where "objectId" = e."sender"), (select "id" from nodes where "objectId" = e."room_id"), e."timestamp", (select case when e."unlisted" = true then false else true end), (select case when e."type" = 'kick' or e."type" = 'ban' then true else false end), e."id" from membership_events as e where e."room_id" is not null;
insert into timeline_events ("linkId", "timestamp", "message", "matrixEventId") select links."id", (select e."timestamp" from membership_events as e where e."id" = links."_legacy_link_id"), (select e."message" from membership_events as e where e."id" = links."_legacy_link_id"), (select e."event_id" from membership_events as e where e.id = links."_legacy_link_id") from links where links."type" <> 'message';
update links set "isRedacted" = true where "isVisible" = false and "type" = 'self_link';

-- Create all the state events for links
insert into state_events ("type", "linkId", "timestamp") select 'link_added', links."id", (select e."timestamp" from timeline_events as e where e."linkId" = links."id") from links;
insert into state_events ("type", "linkId", "timestamp") select 'link_removed', links."id", (select e."timestamp" + interval '1 second' from timeline_events as e where e."linkId" = links."id") from links where links."isVisible" = true;

-- Create placeholder versions for the nodes we know about
-- These will later be populated by the bot on first start
insert into node_versions ("nodeId", "isAnonymous") select nodes."id", case when (select count(*) from enrolled_users where "user_id" = nodes."objectId") > 0 then false else true end from nodes;

-- Create all the state events for nodes
insert into state_events ("type", "nodeId", "nodeVersionId", "timestamp") select 'node_added', nodes."id", (select node_versions."id" from node_versions where node_versions."nodeId" = nodes."id"), nodes."firstTimestamp" from nodes;
insert into state_events ("type", "nodeId", "nodeVersionId", "timestamp") select 'node_removed', nodes."id", (select node_versions."id" from node_versions where node_versions."nodeId" = nodes."id"), (select max(e."timestamp") from timeline_events as e join links as e2 on e2."id" = e."linkId" where e2."targetNodeId" = nodes."id" and (e2."type" = 'kick' or e2."type" = 'ban')) from nodes where nodes."isRedacted" = true;