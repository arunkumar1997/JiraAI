-- PostgreSQL initialization for JIRA Data Center + JIRA AI
-- This script runs once on first container start.

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

-- Apply settings to the app database
\c jiraai

ALTER DATABASE jiraai SET log_min_duration_statement = 10000;
ALTER DATABASE jiraai SET client_encoding = 'UTF8';
ALTER DATABASE jiraai SET standard_conforming_strings = on;
ALTER DATABASE jiraai SET timezone = 'UTC';

-- Enable pgvector extension for RAG embeddings
CREATE EXTENSION IF NOT EXISTS vector;
