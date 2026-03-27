# Environment Variables Reference

All variables are loaded from `.env.local` (secrets) and `.env` (defaults).  
Copy `.env.example` → `.env.local` and fill in your values. **Never commit `.env.local`.**

---

## Required Variables

| Variable   | Description                             | Example      |
| ---------- | --------------------------------------- | ------------ |
| `JIRA_PAT` | Personal Access Token for JIRA API auth | `ATt0kEn...` |

---

## JIRA Connection

| Variable           | Default                 | Description                          |
| ------------------ | ----------------------- | ------------------------------------ |
| `JIRA_BASE_URL`    | `http://localhost:8080` | Base URL of your JIRA instance       |
| `JIRA_PROJECT_KEY` | `PROJ`                  | Default JIRA project key (uppercase) |
| `JIRA_BOARD_ID`    | `1`                     | Scrum board ID for sprint operations |

**Find your board ID:**

```bash
curl -H "Authorization: Bearer $JIRA_PAT" \
  http://localhost:8080/rest/agile/1.0/board | python3 -m json.tool
```

---

## JIRA Custom Field IDs

Custom field IDs vary per JIRA installation. Discover them:

```bash
curl -H "Authorization: Bearer $JIRA_PAT" \
  http://localhost:8080/rest/api/2/field \
  | python3 -c "import json,sys; [print(f['id'], f['name']) for f in json.load(sys.stdin) if f.get('custom')]"
```

| Variable                         | Default             | What it maps to                       |
| -------------------------------- | ------------------- | ------------------------------------- |
| `JIRA_FIELD_STORY_POINTS`        | `customfield_10016` | Story Points / Story point estimate   |
| `JIRA_FIELD_EPIC_LINK`           | `customfield_10014` | Epic Link (links Story to Epic)       |
| `JIRA_FIELD_EPIC_NAME`           | `customfield_10011` | Epic Name (display name on Epic card) |
| `JIRA_FIELD_SPRINT`              | `customfield_10020` | Sprint field                          |
| `JIRA_FIELD_ACCEPTANCE_CRITERIA` | `customfield_10006` | Acceptance Criteria (if installed)    |

---

## Logging

| Variable    | Default                | Description                                 |
| ----------- | ---------------------- | ------------------------------------------- |
| `LOG_LEVEL` | `info`                 | Log level: `error`, `warn`, `info`, `debug` |
| `LOG_FILE`  | `logs/jira-ai-mcp.log` | File path for log output                    |

Set `LOG_LEVEL=debug` to see every JIRA API request and response summary.

---

## Draft Storage

| Variable             | Default        | Description                                 |
| -------------------- | -------------- | ------------------------------------------- |
| `DRAFT_STORAGE_PATH` | `.drafts.json` | Path to persist draft state across restarts |

The draft file stores all pending/approved/committed drafts as JSON.  
Safe to delete if you want to clear all drafts (committed issues remain in JIRA).

---

## Docker Environment Variables

These are in `docker/.env` (not `.env.local`) and are only used by Docker Compose.

| Variable            | Required    | Description                              |
| ------------------- | ----------- | ---------------------------------------- |
| `POSTGRES_PASSWORD` | ✅          | PostgreSQL password for the JIRA DB user |
| `POSTGRES_USER`     | `jira`      | PostgreSQL username                      |
| `POSTGRES_DB`       | `jiradb`    | PostgreSQL database name                 |
| `JIRA_HOSTNAME`     | `localhost` | Hostname JIRA uses in generated URLs     |
| `JIRA_PROXY_PORT`   | `80`        | Port exposed by nginx                    |
| `JIRA_SCHEME`       | `http`      | `http` or `https`                        |

---

## Complete `.env.local` Example

```env
# ─── Required ─────────────────────────────────────────────────────────
JIRA_PAT=your-personal-access-token-here

# ─── JIRA Connection ──────────────────────────────────────────────────
JIRA_BASE_URL=http://localhost:8080
JIRA_PROJECT_KEY=PROJ
JIRA_BOARD_ID=1

# ─── Custom Fields (check your installation) ──────────────────────────
JIRA_FIELD_STORY_POINTS=customfield_10016
JIRA_FIELD_EPIC_LINK=customfield_10014
JIRA_FIELD_EPIC_NAME=customfield_10011
JIRA_FIELD_SPRINT=customfield_10020
JIRA_FIELD_ACCEPTANCE_CRITERIA=customfield_10006

# ─── Logging ──────────────────────────────────────────────────────────
LOG_LEVEL=info
LOG_FILE=logs/jira-ai-mcp.log

# ─── Draft Storage ────────────────────────────────────────────────────
DRAFT_STORAGE_PATH=.drafts.json
```
