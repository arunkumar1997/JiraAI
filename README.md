# JIRA AI MCP Server

> **AI-powered Agile workflow automation.** Transform meeting summaries into fully structured JIRA epics, stories, tasks, bugs, and sub-tasks — with mandatory human approval before any changes hit JIRA.

---

## What It Does

This is an **MCP (Model Context Protocol) server** that plugs into Claude (or any MCP-compatible AI). It replaces most of the manual Scrum Master / Product Owner workflow:

| What you give it  | What you get                                                    |
| ----------------- | --------------------------------------------------------------- |
| Raw meeting notes | Structured JIRA draft: Epics → Stories → Tasks → Bugs           |
| Draft review      | Human approval gate — nothing touches JIRA without you          |
| Approval          | Atomically commits all approved issues to JIRA |

The AI handles: sprint planning, backlog refinement, daily standup updates, sprint review summaries, and retrospective action items.

---

## Quick Start

### 1. Configure the MCP server

```bash
cp .env.example .env
# Edit .env — set JIRA_BASE_URL, JIRA_PAT and JIRA_PROJECT_KEY
```

Or run the one-shot setup script which handles prerequisites, `.env` creation, and Docker image build in one go:

```bash
chmod +x setup.sh
./setup.sh
```

What `setup.sh` does:
1. Checks Docker and Docker Compose v2 are available
2. Creates `.env` from `.env.example` if not already present
3. Builds the `jira-ai-mcp` Docker image
4. Optionally launches the full stack (PostgreSQL + Ollama + jira-ai-mcp)

### 2. Build & run

```bash
npm install
npm run build
npm start
```

### 2a. Build Docker image for VS Code MCP

If you run the MCP server from `.vscode/mcp.json` with Docker, build the local image once:

```bash
docker build -t jira-ai-mcp:local .
```

### 3. Connect to Claude Desktop

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jira-ai": {
      "command": "node",
      "args": ["/path/to/JiraAI/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
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
| `search_project_docs`   | Semantic search over ingested project docs (RAG)                          |
| `jira_search_issues`    | JQL-based search                                                          |
| `jira_create_sprint`    | Create a new sprint                                                       |
| `jira_move_to_sprint`   | Move issues into a sprint                                                 |
| `jira_transition_issue` | Move issue through workflow statuses                                      |
| `transcribe_meeting`    | Transcribe a short recording (< ~20 min) synchronously via Whisper AI     |
| `start_transcription`   | Start a background transcription job for long recordings (any duration)   |
| `get_transcription_result` | Poll for result of a background transcription job                      |
| …                       | See [docs/api/TOOL_SCHEMAS.md](docs/api/TOOL_SCHEMAS.md) for all 22 tools |

---

## Project Structure

```
JiraAI/
├── src/
│   ├── index.ts                  # MCP server entry + tool registry
│   ├── config.ts                 # Environment config
│   ├── ai/
│   │   └── draft-manager.ts      # Draft state machine (human-in-the-loop)
│   ├── jira/
│   │   ├── client.ts             # JIRA REST API v2 client (axios)
│   │   └── types.ts              # TypeScript interfaces
│   ├── tools/
│   │   ├── draft-tools.ts        # AI workflow tools (create/approve/commit draft)
│   │   ├── issue-tools.ts        # CRUD issue tools
│   │   ├── sprint-tools.ts       # Sprint management
│   │   ├── search-tools.ts       # JQL search, project/user queries
│   │   ├── comment-tools.ts      # Issue comments
│   │   ├── workflow-tools.ts     # Status transitions
│   │   ├── docs-tools.ts         # search_project_docs RAG tool
│   │   └── transcription-tools.ts # Whisper-based meeting transcription
│   ├── utils/
│   │   ├── logger.ts             # Winston structured logger
│   │   ├── database.ts           # Prisma client singleton
│   │   └── rag.ts                # Ollama embedding + pgvector search
│   ├── scripts/
│   │   └── ingest-docs.ts        # CLI to chunk & embed docs into PostgreSQL
│   └── __tests__/
│       ├── unit/                 # Unit tests per tool/module
│       └── integration/          # End-to-end draft lifecycle tests
├── prisma/
│   ├── schema.prisma             # Prisma schema (doc_chunks, doc_embeddings)
│   ├── prisma.config.ts          # Prisma config
│   └── migrations/               # SQL migration history
├── docker/                       # Dev-only Docker stack
│   ├── docker-compose.yml        # PostgreSQL + nginx
│   ├── .env.example              # Docker env vars template
│   ├── nginx/nginx.conf          # Reverse proxy config
│   └── init-db.sql               # PostgreSQL initialization
├── docs/                         # Architecture, setup, and API docs
│   ├── architecture/
│   ├── setup/
│   ├── prompts/
│   ├── api/
│   ├── decisions/
│   └── testing/
├── Dockerfile                    # MCP server Docker image
├── docker-compose.yml            # Root compose file
├── mcp.json                      # MCP server manifest
├── package.json
├── tsconfig.json
├── setup.sh                      # One-shot dev environment setup
└── .env.example                  # MCP server env vars template
```

---

## Documentation

| Doc                                                            | Description                          |
| -------------------------------------------------------------- | ------------------------------------ |
| [SYSTEM_DESIGN.md](docs/architecture/SYSTEM_DESIGN.md)         | Overall architecture & data flow     |
| [MCP_SERVER_DESIGN.md](docs/architecture/MCP_SERVER_DESIGN.md) | MCP protocol & tool structure        |
| [JIRA_INTEGRATION.md](docs/architecture/JIRA_INTEGRATION.md)   | JIRA API auth & field mapping        |
| [ENV_VARIABLES.md](docs/setup/ENV_VARIABLES.md)                | All environment variables            |
| [TOOL_SCHEMAS.md](docs/api/TOOL_SCHEMAS.md)                    | Full JSON schemas for all tools      |
| [JIRA_FIELD_MAPPING.md](docs/api/JIRA_FIELD_MAPPING.md)        | AI fields → JIRA custom fields       |
| [EXAMPLES.md](docs/prompts/EXAMPLES.md)                        | Sample inputs & expected outputs     |
| [TEST_PLAN.md](docs/testing/TEST_PLAN.md)                      | Unit, integration, E2E test strategy |
| [ADR-001.md](docs/decisions/ADR-001.md)                        | Architecture Decision Records        |

---

## RAG — Project Docs Search

The server includes a **Retrieval-Augmented Generation (RAG)** pipeline that lets the AI search your project documentation semantically before creating JIRA issues.

### How It Works

1. **Ingest** — Markdown/text files are chunked and embedded via [Ollama](https://ollama.com) (`nomic-embed-text` by default) and stored in PostgreSQL using `pgvector`.
2. **Search** — The `search_project_docs` MCP tool queries the vector store using cosine similarity to return the most relevant passages.
3. **Augment** — The AI uses the retrieved context (requirements, architecture constraints, terminology) to produce higher-quality, domain-aware JIRA drafts.

### Setup

#### 1. Start Ollama and pull the embedding model

```bash
ollama pull nomic-embed-text
```

#### 2. Configure environment variables

```env
DOCS_FOLDER=/path/to/your/project/docs   # folder to ingest
OLLAMA_URL=http://localhost:11434         # Ollama base URL
EMBEDDING_MODEL=nomic-embed-text         # model used for embeddings
```

#### 3. Ingest your docs

```bash
# Index all supported files (.md, .txt, .markdown) in DOCS_FOLDER
DOCS_FOLDER=/path/to/docs npm run ingest-docs

# Force re-index all files (even unchanged ones)
DOCS_FOLDER=/path/to/docs npm run ingest-docs -- --force

# Clear all indexed docs without re-ingesting
npm run ingest-docs -- --clear
```

### MCP Tool

| Tool                  | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `search_project_docs` | Semantically search ingested docs — call before creating JIRA issues to pull in domain-specific context |

### Database Schema

Docs are stored in two tables (see `prisma/schema.prisma`):

- **`doc_chunks`** — raw text chunks with `source_file` reference
- **`doc_embeddings`** — pgvector `embedding` column linked to each chunk

---

## Security Notes

- **JIRA_PAT is a secret** — store in `.env` only, never commit
- Delete issues require the confirmation phrase `"DELETE CONFIRMED"` in the API call
- Nothing commits to JIRA without explicit human `APPROVE` response
- All tool actions are logged with timestamps and issue keys
