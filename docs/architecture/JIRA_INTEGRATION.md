# JIRA Integration Guide

## JIRA Data Center vs Cloud

This server targets **JIRA Software Data Center** (self-hosted), which uses:

- REST API **v2** (`/rest/api/2/`)
- Agile API **v1** (`/rest/agile/1.0/`)
- **Bearer token** (PAT) authentication

> JIRA Cloud uses API v3 with Atlassian Document Format (ADF) for `description`. Data Center v2 accepts plain text / wiki markup strings — no ADF needed.

---

## Authentication

### Creating a Personal Access Token (PAT)

1. Log into JIRA at `http://localhost:8080`
2. Go to **Profile** (top-right avatar) → **Personal Access Tokens**
3. Click **Create token**
4. Name: `jira-ai-mcp` | Expiry: your preference
5. Copy the token — it's shown only once

Set in `.env.local`:

```
JIRA_PAT=your-token-here
```

The server sends:

```
Authorization: Bearer <PAT>
X-Atlassian-Token: no-check
```

`X-Atlassian-Token: no-check` is required for JIRA Data Center to bypass CSRF protection on POST/PUT/DELETE requests with JSON bodies.

---

## API Endpoints Used

### REST API v2

| Method | Endpoint                              | Tool                                     |
| ------ | ------------------------------------- | ---------------------------------------- |
| POST   | `/rest/api/2/issue`                   | `jira_create_issue`, `commit_jira_draft` |
| GET    | `/rest/api/2/issue/{key}`             | `jira_get_issue`                         |
| PUT    | `/rest/api/2/issue/{key}`             | `jira_update_issue`                      |
| DELETE | `/rest/api/2/issue/{key}`             | `jira_delete_issue`                      |
| PUT    | `/rest/api/2/issue/{key}/assignee`    | `jira_assign_issue`                      |
| POST   | `/rest/api/2/issueLink`               | `jira_link_issues`                       |
| POST   | `/rest/api/2/search`                  | `jira_search_issues`                     |
| POST   | `/rest/api/2/issue/{key}/comment`     | `jira_add_comment`                       |
| GET    | `/rest/api/2/issue/{key}/transitions` | `jira_get_transitions`                   |
| POST   | `/rest/api/2/issue/{key}/transitions` | `jira_transition_issue`                  |
| GET    | `/rest/api/2/project/{key}`           | `jira_get_project`                       |
| GET    | `/rest/api/2/user/assignable/search`  | `jira_list_users`                        |
| GET    | `/rest/api/2/field`                   | Field discovery                          |

### Agile API v1

| Method | Endpoint                            | Tool                  |
| ------ | ----------------------------------- | --------------------- |
| POST   | `/rest/agile/1.0/sprint`            | `jira_create_sprint`  |
| PUT    | `/rest/agile/1.0/sprint/{id}`       | `jira_update_sprint`  |
| POST   | `/rest/agile/1.0/sprint/{id}/issue` | `jira_move_to_sprint` |
| GET    | `/rest/agile/1.0/board/{id}`        | `jira_get_board`      |
| GET    | `/rest/agile/1.0/board/{id}/sprint` | `jira_get_board`      |

---

## Custom Field Discovery

Custom field IDs (like `customfield_10016` for Story Points) vary per JIRA installation. Run this to discover yours:

```bash
curl -H "Authorization: Bearer $JIRA_PAT" \
     http://localhost:8080/rest/api/2/field \
  | jq '.[] | select(.custom==true) | {id, name}'
```

Look for:

- `Story Points` or `Story point estimate` → `JIRA_FIELD_STORY_POINTS`
- `Epic Link` → `JIRA_FIELD_EPIC_LINK`
- `Epic Name` → `JIRA_FIELD_EPIC_NAME`
- `Sprint` → `JIRA_FIELD_SPRINT`

### Typical Field IDs (JIRA 9.x)

| Field               | Typical ID          | Notes                                        |
| ------------------- | ------------------- | -------------------------------------------- |
| Story Points        | `customfield_10016` | May be `customfield_10028` in older installs |
| Epic Link           | `customfield_10014` | Links Story/Task to parent Epic              |
| Epic Name           | `customfield_10011` | Short name on Epic card                      |
| Sprint              | `customfield_10020` | Accepts sprint ID (number)                   |
| Acceptance Criteria | Varies              | Often not present by default                 |

---

## Issue Type Hierarchy

```
Epic
└── Story              (Epic Link → Epic)
    ├── Sub-task       (parent → Story)
    └── Task           (Epic Link → Epic)
Bug                    (Epic Link → Epic, linked via "Relates")
Spike                  (Story type + "Spike" label)
```

### Creating an Epic

```json
{
  "fields": {
    "issuetype": { "name": "Epic" },
    "project":   { "key": "PROJ" },
    "summary":   "User Authentication Module",
    "customfield_10011": "Auth Module"   ← Epic Name (required for Epics)
  }
}
```

### Creating a Story linked to an Epic

```json
{
  "fields": {
    "issuetype": { "name": "Story" },
    "customfield_10014": "PROJ-1"        ← Epic Link key
  }
}
```

### Creating a Sub-task

```json
{
  "fields": {
    "issuetype": { "name": "Sub-task" },
    "parent": { "key": "PROJ-2" }        ← Parent Story/Task key
  }
}
```

---

## JQL Reference

Common queries used by the server:

```jql
# Active sprint items
project = PROJ AND sprint in openSprints()

# Unassigned open bugs by priority
project = PROJ AND issuetype = Bug AND status != Done
AND assignee is EMPTY ORDER BY priority ASC

# All items in an Epic
"Epic Link" = PROJ-5

# Items flagged with ai-generated label
project = PROJ AND labels = "ai-generated"

# Stale backlog (not updated in 30 days)
project = PROJ AND status = "To Do" AND updated <= -30d
ORDER BY created ASC
```

---

## Error Handling

JIRA returns errors in this shape:

```json
{
  "errorMessages": [
    "Issue does not exist or you do not have permission to see it."
  ],
  "errors": { "summary": "Field 'summary' cannot be empty." }
}
```

The JIRA client logs both `errorMessages` and `errors` fields on every failure and re-throws. Tool handlers surface the message to Claude without auto-retrying.

---

## Rate Limits

JIRA Data Center does not enforce API rate limits by default, but Atlassian recommends:

- Max 1 request/second for write operations in production
- Use `maxResults` parameter in search (default: 50, max: 100)
- Avoid parallel write operations to the same issue
