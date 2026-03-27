-- PostgreSQL initialization for JIRA Data Center
-- This script runs once on first container start.

-- JIRA requires UTF-8 encoding and specific settings for performance.
-- The database and user are created automatically by the POSTGRES_DB / POSTGRES_USER
-- environment variables in docker-compose. This script applies tuning settings.

-- Performance settings recommended by Atlassian for JIRA
ALTER SYSTEM SET max_connections = '200';
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '768MB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = '0.9';
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = '100';
ALTER SYSTEM SET random_page_cost = '1.1';
ALTER SYSTEM SET effective_io_concurrency = '200';

-- Apply to the JIRA database  
\c jiradb

ALTER DATABASE jiradb SET log_min_duration_statement = 10000;
ALTER DATABASE jiradb SET client_encoding = 'UTF8';
ALTER DATABASE jiradb SET standard_conforming_strings = on;
ALTER DATABASE jiradb SET timezone = 'UTC';
