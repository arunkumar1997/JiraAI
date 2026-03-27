import { homedir } from "os";
import { join } from "path";

// All configuration is injected via environment variables by VS Code through
// contributes.mcpServerDefinitions.env — no dotenv needed in this build.

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    process.stderr.write(
      `[config] FATAL: Missing required environment variable: ${key}\n` +
        `[config] Set it in VS Code Settings under "JIRA AI MCP".\n`,
    );
    process.exit(1);
  }
  return val;
}

function optional(key: string, defaultVal: string): string {
  return process.env[key] || defaultVal;
}

// Default draft storage lives in the user's home directory so it persists
// across VS Code restarts and workspace changes.
const DEFAULT_DRAFT_PATH = join(homedir(), ".jira-ai-mcp", ".drafts.json");

export const Config = {
  jira: {
    baseUrl: optional("JIRA_BASE_URL", "http://localhost:8080"),
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
  },
  draftStoragePath: optional("JIRA_AI_DRAFT_PATH", DEFAULT_DRAFT_PATH),
  server: {
    name: "jira-ai-mcp-server",
    version: "1.0.0",
  },
} as const;
