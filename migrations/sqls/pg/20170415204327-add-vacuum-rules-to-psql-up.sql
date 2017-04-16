ALTER TABLE node_versions SET (autovacuum_vacuum_scale_factor = 0.0);  
ALTER TABLE node_versions SET (autovacuum_vacuum_threshold = 5000);  
ALTER TABLE node_versions SET (autovacuum_analyze_scale_factor = 0.0);  
ALTER TABLE node_versions SET (autovacuum_analyze_threshold = 5000);  

ALTER TABLE nodes SET (autovacuum_vacuum_scale_factor = 0.0);  
ALTER TABLE nodes SET (autovacuum_vacuum_threshold = 5000);  
ALTER TABLE nodes SET (autovacuum_analyze_scale_factor = 0.0);  
ALTER TABLE nodes SET (autovacuum_analyze_threshold = 5000); 

ALTER TABLE links SET (autovacuum_vacuum_scale_factor = 0.0);  
ALTER TABLE links SET (autovacuum_vacuum_threshold = 5000);  
ALTER TABLE links SET (autovacuum_analyze_scale_factor = 0.0);  
ALTER TABLE links SET (autovacuum_analyze_threshold = 5000); 

ALTER TABLE state_events SET (autovacuum_vacuum_scale_factor = 0.0);  
ALTER TABLE state_events SET (autovacuum_vacuum_threshold = 5000);  
ALTER TABLE state_events SET (autovacuum_analyze_scale_factor = 0.0);  
ALTER TABLE state_events SET (autovacuum_analyze_threshold = 5000);  

ALTER TABLE timeline_events SET (autovacuum_vacuum_scale_factor = 0.0);  
ALTER TABLE timeline_events SET (autovacuum_vacuum_threshold = 5000);  
ALTER TABLE timeline_events SET (autovacuum_analyze_scale_factor = 0.0);  
ALTER TABLE timeline_events SET (autovacuum_analyze_threshold = 5000);  

-- This can't be run in a transaction, but it is recommended to still run this.
--VACUUM ANALYZE node_versions;
--VACUUM ANALYZE nodes;
--VACUUM ANALYZE links;
--VACUUM ANALYZE state_events;
--VACUUM ANALYZE timeline_events;