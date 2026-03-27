# JIRA AI MCP Server

> **AI-powered Agile workflow automation.** Transform meeting summaries into fully structured JIRA epics, stories, tasks, bugs, and sub-tasks — with mandatory human approval before any changes hit JIRA.

---

## What It Does

This is an **MCP (Model Context Protocol) server** that plugs into Claude (or any MCP-compatible AI). It replaces most of the manual Scrum Master / Product Owner workflow:

| What you give it  | What you get                                                    |
| ----------------- | --------------------------------------------------------------- |
| Raw meeting notes | Structured JIRA draft: Epics → Stories → Tasks → Bugs           |
| Draft review      | Human approval gate — nothing touches JIRA without you          |
| Approval          | Atomically commits all approved issues to your self-hosted JIRA |

The AI handles: sprint planning, backlog refinement, daily standup updates, sprint review summaries, and retrospective action items.

---

## Quick Start

### 1. Start JIRA (Docker)

```bash
cp docker/.env.example docker/.env
# Edit docker/.env — set POSTGRES_PASSWORD at minimum
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d
```

Open http://localhost:8080 — complete the JIRA setup wizard.  
See [docs/setup/LOCAL_JIRA_SETUP.md](docs/setup/LOCAL_JIRA_SETUP.md) for the full step-by-step.

### 2. Configure the MCP server

```bash
cp .env.example .env.local
# Edit .env.local — set JIRA_PAT and JIRA_PROJECT_KEY
```

### 3. Build & run

```bash
npm install
npm run build
npm start
```

### 4. Connect to Claude Desktop

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jira-ai": {
      "command": "node",
      "args": ["/home/arun/jiraAI/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "http://localhost:8080",
        "JIRA_PAT": "your-pat-here",
        "JIRA_PROJECT_KEY": "PROJ"
      }
    }
  }
}
```

---

## Usage Example

In Claude:

> _"We agreed to build the user authentication module this sprint. It needs login, registration, and password reset. There's a bug where the login button is misaligned on mobile. We need to spike OAuth 2.0 feasibility."_

Claude analyzes the notes, calls `create_jira_draft`, and presents:

```
JIRA DRAFT REVIEW SUMMARY
═══════════════════════════════════════════════════════════

── EPICS (1) ──
  [EPIC-01] User Authentication Module
         Priority: High  |  Story Points: 13

── STORIES (3) ──
  [STORY-01] User Login
  [STORY-02] User Registration (with email verification)
  [STORY-03] Password Reset

── BUGS (1) ──
  [BUG-01] Login button misaligned on mobile  (High priority)

── SPIKES (1) ──
  [SPIKE-01] Investigate OAuth 2.0 feasibility  (2pts)

AWAITING YOUR DECISION:
  APPROVE ALL | APPROVE [list] | REJECT + feedback
```

Respond **APPROVE ALL** → Claude calls `approve_jira_draft` then `commit_jira_draft` → 6 issues created in JIRA.

---

## MCP Tools

| Tool                    | Purpose                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `create_jira_draft`     | Store analyzed artifacts as a draft for review                            |
| `approve_jira_draft`    | Approve all or specific items                                             |
| `reject_jira_draft`     | Reject with feedback for revision                                         |
| `commit_jira_draft`     | **Actually** commit approved items to JIRA                                |
| `jira_create_issue`     | Create a single issue directly                                            |
| `jira_update_issue`     | Update an existing issue                                                  |
| `jira_delete_issue`     | Delete (requires confirmation phrase)                                     |
| `jira_search_issues`    | JQL-based search                                                          |
| `jira_create_sprint`    | Create a new sprint                                                       |
| `jira_move_to_sprint`   | Move issues into a sprint                                                 |
| `jira_transition_issue` | Move issue through workflow statuses                                      |
| …                       | See [docs/api/TOOL_SCHEMAS.md](docs/api/TOOL_SCHEMAS.md) for all 22 tools |

---

## Project Structure

```
jiraAI/
├── src/
│   ├── index.ts              # MCP server entry + tool registry
│   ├── config.ts             # Environment config
│   ├── jira/
│   │   ├── client.ts         # JIRA REST API v2 client (axios)
│   │   └── types.ts          # TypeScript interfaces
│   ├── ai/
│   │   └── draft-manager.ts  # Draft state machine (human-in-the-loop)
│   ├── tools/
│   │   ├── draft-tools.ts    # AI workflow tools (create/approve/commit draft)
│   │   ├── issue-tools.ts    # CRUD issue tools
│   │   ├── sprint-tools.ts   # Sprint management
│   │   ├── search-tools.ts   # JQL search, project/user queries
│   │   ├── comment-tools.ts  # Issue comments
│   │   └── workflow-tools.ts # Status transitions
│   └── utils/
│       └── logger.ts         # Winston structured logger
├── docker/
│   ├── docker-compose.yml    # JIRA + PostgreSQL + nginx
│   ├── .env.example          # Docker env vars template
│   ├── nginx/nginx.conf      # Reverse proxy config
│   └── init-db.sql           # PostgreSQL initialization
├── docs/                     # Architecture, setup, and API docs
│   ├── architecture/
│   ├── setup/
│   ├── prompts/
│   ├── api/
│   ├── decisions/
│   └── testing/
└── .env.example              # MCP server env vars template
```

---

## Documentation

| Doc                                                            | Description                          |
| -------------------------------------------------------------- | ------------------------------------ |
| [SYSTEM_DESIGN.md](docs/architecture/SYSTEM_DESIGN.md)         | Overall architecture & data flow     |
| [MCP_SERVER_DESIGN.md](docs/architecture/MCP_SERVER_DESIGN.md) | MCP protocol & tool structure        |
| [JIRA_INTEGRATION.md](docs/architecture/JIRA_INTEGRATION.md)   | JIRA API auth & field mapping        |
| [LOCAL_JIRA_SETUP.md](docs/setup/LOCAL_JIRA_SETUP.md)          | Docker setup step-by-step            |
| [ENV_VARIABLES.md](docs/setup/ENV_VARIABLES.md)                | All environment variables            |
| [TOOL_SCHEMAS.md](docs/api/TOOL_SCHEMAS.md)                    | Full JSON schemas for all tools      |
| [JIRA_FIELD_MAPPING.md](docs/api/JIRA_FIELD_MAPPING.md)        | AI fields → JIRA custom fields       |
| [EXAMPLES.md](docs/prompts/EXAMPLES.md)                        | Sample inputs & expected outputs     |
| [TEST_PLAN.md](docs/testing/TEST_PLAN.md)                      | Unit, integration, E2E test strategy |
| [ADR-001.md](docs/decisions/ADR-001.md)                        | Architecture Decision Records        |

---

## Security Notes

- **JIRA_PAT is a secret** — store in `.env.local` only, never commit
- Delete issues require the confirmation phrase `"DELETE CONFIRMED"` in the API call
- Nothing commits to JIRA without explicit human `APPROVE` response
- All tool actions are logged with timestamps and issue keys
