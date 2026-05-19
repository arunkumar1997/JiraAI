# Environment Variables Reference

All variables are loaded from `.env`.
Copy `.env.example` → `.env` and fill in your values. **Never commit `.env`.**

---

## Required Variables

| Variable   | Description                             | Example      |
| ---------- | --------------------------------------- | ------------ |
| `JIRA_PAT` | Personal Access Token for JIRA API auth | `ATt0kEn...` |

---

## JIRA Connection

| Variable           | Default                 | Description                          |
| ------------------ | ----------------------- | ------------------------------------ |
| `JIRA_BASE_URL`    | `https://your-domain.atlassian.net` | Base URL of your JIRA instance       |
| `JIRA_PROJECT_KEY` | `PROJ`                  | Default JIRA project key (uppercase) |
| `JIRA_BOARD_ID`    | `1`                     | Scrum board ID for sprint operations |

**Find your board ID:**

```bash
curl -H "Authorization: Bearer $JIRA_PAT" \
  $JIRA_BASE_URL/rest/agile/1.0/board | python3 -m json.tool
```

---

## JIRA Custom Field IDs

Custom field IDs vary per JIRA installation. Discover them:

```bash
curl -H "Authorization: Bearer $JIRA_PAT" \
  $JIRA_BASE_URL/rest/api/2/field \
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

## Database (RAG)

| Variable       | Required | Description                                      |
| -------------- | -------- | ------------------------------------------------ |
| `DATABASE_URL` | ✅       | PostgreSQL connection string for pgvector store  |

Example: `postgresql://user:password@localhost:5432/jiraai`

---

## RAG — Document Search

| Variable          | Default                     | Description                                  |
| ----------------- | --------------------------- | -------------------------------------------- |
| `DOCS_FOLDER`     | _(empty)_                   | Folder path to ingest docs from              |
| `OLLAMA_URL`      | `http://localhost:11434`    | Ollama base URL for generating embeddings    |
| `EMBEDDING_MODEL` | `nomic-embed-text`          | Ollama model used for embedding              |

Run `npm run ingest-docs` after setting `DOCS_FOLDER` to index your project docs.

---

## Transcription

| Variable         | Default   | Description                                                              |
| ---------------- | --------- | ------------------------------------------------------------------------ |
| `WHISPER_PYTHON` | `python3` | Python executable with `faster-whisper` installed (e.g. `.venv/bin/python`) |

---

## Complete `.env` Example

```env
# ─── Required ─────────────────────────────────────────────────────────
JIRA_PAT=your-personal-access-token-here
DATABASE_URL=postgresql://user:password@localhost:5432/jiraai

# ─── JIRA Connection ──────────────────────────────────────────────────
JIRA_BASE_URL=https://your-domain.atlassian.net
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

# ─── RAG ──────────────────────────────────────────────────────────────
DOCS_FOLDER=/path/to/your/project/docs
OLLAMA_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text

# ─── Transcription (optional) ─────────────────────────────────────────
WHISPER_PYTHON=python3
```
