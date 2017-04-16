-- Cross-compatible with sqlite and pg

INSERT INTO node_meta ("nodeId", "displayName", "avatarUrl", "isAnonymous", "primaryAlias")
SELECT  nodes.id,
        (SELECT "displayName" from node_versions where "nodeId" = nodes.id AND "displayName" IS NOT NULL ORDER BY id DESC LIMIT 1),
        (SELECT "avatarUrl" from node_versions where "nodeId" = nodes.id AND "avatarUrl" IS NOT NULL ORDER BY id DESC LIMIT 1),
        (SELECT "isAnonymous" from node_versions where "nodeId" = nodes.id AND "isAnonymous" IS NOT NULL ORDER BY id DESC LIMIT 1),
        (SELECT "primaryAlias" from node_versions where "nodeId" = nodes.id AND "primaryAlias" IS NOT NULL ORDER BY id DESC LIMIT 1)
FROM nodes;

UPDATE nodes SET "nodeMetaId" = (SELECT node_meta.id FROM node_meta WHERE "nodeId" = nodes.id);