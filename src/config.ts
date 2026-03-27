import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local first (secrets), then .env (defaults)
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(
      `[config] FATAL: Missing required environment variable: ${key}`,
    );
    console.error(
      `[config] Copy .env.example to .env.local and fill in the values.`,
    );
    process.exit(1);
  }
  return val;
}

function optional(key: string, defaultVal: string): string {
  return process.env[key] || defaultVal;
}

export const Config = {
  jira: {
    baseUrl: optional("JIRA_BASE_URL", "http://localhost:81"),
    pat: required("JIRA_PAT"),
    projectKey: optional("JIRA_PROJECT_KEY", "PROJ"),
    boardId: parseInt(optional("JIRA_BOARD_ID", "1"), 10),
    fields: {
      storyPoints: optional("JIRA_FIELD_STORY_POINTS", "customfield_10016"),
      epicLink: optional("JIRA_FIELD_EPIC_LINK", "customfield_10014"),
      epicName: optional("JIRA_FIELD_EPIC_NAME", "customfield_10011"),
      sprint: optional("JIRA_FIELD_SPRINT", "customfield_10020"),
      acceptanceCriteria: optional(
        "JIRA_FIELD_ACCEPTANCE_CRITERIA",
        "customfield_10006",
      ),
    },
  },
  logging: {
    level: optional("LOG_LEVEL", "info"),
    file: optional("LOG_FILE", "logs/jira-ai-mcp.log"),
  },
  draftStoragePath: optional("DRAFT_STORAGE_PATH", ".drafts.json"),
  server: {
    name: "jira-ai-mcp-server",
    version: "1.0.0",
  },
} as const;
