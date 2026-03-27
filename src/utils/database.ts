/**
 * SQLite Database Setup & Management
 *
 * Handles creation and initialization of SQLite database
 * for storing JIRA drafts, issues, and metadata.
 */

import Database from "better-sqlite3";
import { join } from "path";
import { logger } from "./logger.js";

class DatabaseService {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        projectKey TEXT NOT NULL,
        meetingContext TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_review',
        feedback TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        committedKeys TEXT
      );

      CREATE TABLE IF NOT EXISTS draft_artifacts (
        id TEXT PRIMARY KEY,
        draftId TEXT NOT NULL,
        ref TEXT NOT NULL,
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        description TEXT NOT NULL,
        priority TEXT DEFAULT 'Medium',
        storyPoints INTEGER DEFAULT 3,
        acceptanceCriteria TEXT,
        testingScenarios TEXT,
        edgeCases TEXT,
        possibleBugs TEXT,
        labels TEXT,
        components TEXT,
        epicRef TEXT,
        parentRef TEXT,
        epicLinkKey TEXT,
        parentKey TEXT,
        assigneeId TEXT,
        sprintId INTEGER,
        flaggedForReview INTEGER DEFAULT 0,
        notes TEXT,
        committedKey TEXT,
        FOREIGN KEY (draftId) REFERENCES drafts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS draft_action_logs (
        id TEXT PRIMARY KEY,
        draftId TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        note TEXT,
        items TEXT,
        FOREIGN KEY (draftId) REFERENCES drafts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        projectKey TEXT NOT NULL,
        issueType TEXT NOT NULL,
        summary TEXT NOT NULL,
        description TEXT,
        priority TEXT,
        status TEXT DEFAULT 'Open',
        assignee TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        draftId TEXT,
        FOREIGN KEY (draftId) REFERENCES drafts(id)
      );

      CREATE INDEX IF NOT EXISTS idx_drafts_projectKey ON drafts(projectKey);
      CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status);
      CREATE INDEX IF NOT EXISTS idx_draft_artifacts_draftId ON draft_artifacts(draftId);
      CREATE INDEX IF NOT EXISTS idx_issues_projectKey ON issues(projectKey);
      CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
    `);

    logger.info("Database schema initialized");
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): any {
    return this.db.prepare(sql);
  }

  transaction<T>(fn: () => T): T {
    const executeTransaction = this.db.transaction(fn);
    return executeTransaction();
  }

  close(): void {
    this.db.close();
    logger.info("Database connection closed");
  }

  getDatabase(): Database.Database {
    return this.db;
  }
}

export const database = new DatabaseService(
  join(process.cwd(), "data", "jira-ai.db"),
);
