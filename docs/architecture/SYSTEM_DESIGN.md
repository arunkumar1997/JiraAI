# System Design — JIRA AI MCP Server

## Overview

The JIRA AI MCP Server is an **MCP (Model Context Protocol) server** that sits between an AI assistant (Claude) and a self-hosted JIRA Data Center instance. It translates natural-language meeting summaries into structured JIRA work items, enforcing a mandatory human-approval gate before anything is written.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER (Scrum Master / PO)                     │
│                         ↓ meeting notes / commands                  │
│                         ↑ review summary / JIRA keys                │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ (Claude Desktop / MCP host)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   AI ASSISTANT (Claude Sonnet)                      │
│                                                                     │
│  • Reads meeting notes                                              │
│  • Identifies Epics, Stories, Tasks, Bugs, Spikes                   │
│  • Infers priorities, story points, AC, labels                      │
│  • Calls MCP tools via stdio transport                              │
└────────────────────────────┬────────────────────────────────────────┘
                             │ stdio (JSON-RPC 2.0)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 JIRA AI MCP SERVER  (Node.js / TypeScript)          │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Draft Manager   │  │   Tool Registry  │  │   JIRA Client    │  │
│  │                  │  │                  │  │                  │  │
│  │  pending_review  │  │  22 MCP tools    │  │  REST API v2     │  │
│  │  approved        │  │  ─────────────── │  │  Bearer Auth     │  │
│  │  rejected     ───┼─►│  Draft tools     │  │  (PAT)           │  │
│  │  committed       │  │  Issue CRUD      │  │                  │  │
│  │                  │  │  Sprint mgmt     │  │  Agile API v1    │  │
│  │  JSON on disk    │  │  Workflow        │  │                  │  │
│  └──────────────────┘  └────────┬─────────┘  └────────┬─────────┘  │
│                                 │                     │            │
└─────────────────────────────────┼─────────────────────┼────────────┘
                                  │ HTTP (axios)         │
                                  ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│              DOCKER STACK  (self-hosted, local)                     │
│                                                                     │
│  ┌─────────────────┐    ┌──────────────────┐   ┌────────────────┐  │
│  │ nginx:1.25      │    │ jira-software:   │   │ postgres:14    │  │
│  │                 │───►│ 9.12.0           │──►│                │  │
│  │ :80 / :443      │    │ :8080            │   │ :5432          │  │
│  │ Reverse proxy   │    │ Data Center      │   │ jiradb         │  │
│  └─────────────────┘    └──────────────────┘   └────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Meeting → JIRA

```
1. User pastes meeting notes into Claude
   │
2. Claude analyzes notes → identifies work items
   │
3. Claude calls create_jira_draft(artifacts=[...])
   │
4. MCP Server stores draft (pending_review)
   │
5. Returns formatted REVIEW SUMMARY to Claude
   │
6. Claude presents review to user
   │
7. User responds: APPROVE ALL / APPROVE [list] / REJECT + feedback
   │
   ├─ REJECT → Claude calls reject_jira_draft + revise_jira_draft → back to step 5
   │
   └─ APPROVE → Claude calls approve_jira_draft
                │
8.             Claude calls commit_jira_draft
               │
9.             MCP Server creates issues in JIRA:
               │  Epics first → Stories → Tasks/Bugs/Spikes → Sub-tasks
               │  (refToKey map ensures correct Epic links)
               │
10.            Returns: list of created JIRA keys
               │
11.            Claude presents results to user
```

---

## Tech Stack

| Layer       | Technology                       | Why                                    |
| ----------- | -------------------------------- | -------------------------------------- |
| MCP Server  | Node.js 18+ / TypeScript 5       | Native ESM, strong typing, MCP SDK     |
| MCP SDK     | `@modelcontextprotocol/sdk` ^1.0 | Official Anthropic SDK                 |
| HTTP Client | axios 1.6                        | Interceptors, typed responses, timeout |
| Validation  | zod 3.22                         | Runtime schema validation              |
| Logging     | winston 3.13                     | Structured JSON logs, file+console     |
| AI          | Claude Sonnet (via MCP host)     | Intelligent meeting analysis           |
| JIRA        | Atlassian JIRA Software 9.12     | Data Center, self-hosted               |
| Database    | PostgreSQL 14                    | Required by JIRA                       |
| Proxy       | nginx 1.25                       | SSL termination, reverse proxy         |
| Container   | Docker Compose v3.8              | Local orchestration                    |

---

## Component Responsibilities

### `src/ai/draft-manager.ts`

- Implements the human-in-the-loop state machine
- Persists draft state to disk (`.drafts.json`) — survives server restarts
- States: `pending_review → approved/rejected → committed`
- Formats the review summary presented to users

### `src/jira/client.ts`

- Thin wrapper over the JIRA REST API v2 and Agile API v1
- All credentials injected from environment (no hardcoded values)
- Structured error logging on all failures

### `src/tools/draft-tools.ts`

- `create_jira_draft` — receives structured artifacts from Claude, stores draft
- `approve_jira_draft` — marks draft (or subset) as approved
- `commit_jira_draft` — the only path to JIRA; requires prior approval
- Field builder constructs correct JIRA API payload (custom fields, epic links, etc.)

### `src/index.ts`

- MCP `Server` bootstrapper
- Tool registry (`ListTools`) + dispatcher (`CallTool`)
- Single error boundary with structured logging

---

## Security Model

1. **No credentials in code** — all via environment variables
2. **PAT-based auth** — JIRA server never gets passwords
3. **Delete gate** — `jira_delete_issue` requires `confirmation_phrase: "DELETE CONFIRMED"`
4. **Approval gate** — `commit_jira_draft` refuses to run without prior approval status
5. **Input validation** — Zod schemas guard all tool inputs at the boundary
6. **Audit log** — every state transition recorded in `draft.actionLog` with timestamp

---

## Horizontal Scaling Considerations

The server is currently stateless-except-for-disk. For team environments:

- Replace `.drafts.json` with Redis or PostgreSQL for shared state
- Add authentication to the MCP endpoint (current: stdio, inherently process-local)
- Add rate limiting to JIRA API calls to avoid hitting JIRA's request limits
