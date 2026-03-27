# JIRA Field Mapping — AI Input → JIRA API Fields

This document maps the AI-generated artifact fields to the actual JIRA REST API v2 field names and custom field IDs used in the API payload.

---

## Standard Fields (all issue types)

| AI Field      | JIRA API Field              | Notes                                       |
| ------------- | --------------------------- | ------------------------------------------- |
| `summary`     | `fields.summary`            | Max 255 chars                               |
| `description` | `fields.description`        | Plain text / wiki markup for Data Center    |
| `type`        | `fields.issuetype.name`     | See Issue Type Mapping below                |
| `priority`    | `fields.priority.name`      | Allowed: Highest, High, Medium, Low, Lowest |
| `labels`      | `fields.labels`             | Array of strings                            |
| `components`  | `fields.components[].name`  | Must match existing component names         |
| `assigneeId`  | `fields.assignee.accountId` | From `jira_list_users`                      |
| `projectKey`  | `fields.project.key`        | e.g. "PROJ"                                 |

---

## Custom Fields

Custom field IDs are installation-specific. Configure via environment variables.

| AI Field             | Env Variable                     | Default Field ID    | JIRA Field Name     |
| -------------------- | -------------------------------- | ------------------- | ------------------- |
| `storyPoints`        | `JIRA_FIELD_STORY_POINTS`        | `customfield_10016` | Story Points        |
| `epicRef` → key      | `JIRA_FIELD_EPIC_LINK`           | `customfield_10014` | Epic Link           |
| epic display name    | `JIRA_FIELD_EPIC_NAME`           | `customfield_10011` | Epic Name           |
| `sprintId`           | `JIRA_FIELD_SPRINT`              | `customfield_10020` | Sprint              |
| `acceptanceCriteria` | `JIRA_FIELD_ACCEPTANCE_CRITERIA` | `customfield_10006` | Acceptance Criteria |

---

## Issue Type Mapping

| AI `type` field | JIRA `issuetype.name` | Notes                                |
| --------------- | --------------------- | ------------------------------------ |
| `Epic`          | `"Epic"`              | Requires `epicName` custom field set |
| `Story`         | `"Story"`             |                                      |
| `Task`          | `"Task"`              |                                      |
| `Bug`           | `"Bug"`               |                                      |
| `Sub-task`      | `"Sub-task"`          | Requires `parent.key`                |
| `Spike`         | `"Story"`             | Label `"Spike"` added automatically  |

---

## Field Construction by Issue Type

### Epic

```json
{
  "fields": {
    "issuetype": { "name": "Epic" },
    "project":   { "key": "PROJ" },
    "summary":   "Auth Module",
    "customfield_10011": "Auth Module",    ← Epic Name (REQUIRED for Epics)
    "customfield_10016": 13,               ← Story Points
    "priority":  { "name": "High" },
    "labels":    ["auth", "ai-generated"],
    "description": "..."
  }
}
```

### Story (linked to Epic)

```json
{
  "fields": {
    "issuetype": { "name": "Story" },
    "project":   { "key": "PROJ" },
    "summary":   "As a user, I want to log in...",
    "customfield_10014": "PROJ-1",         ← Epic Link (key of the Epic)
    "customfield_10016": 5,                ← Story Points
    "customfield_10006": "User can...\n...", ← Acceptance Criteria
    "priority":  { "name": "High" }
  }
}
```

### Task (linked to Epic)

```json
{
  "fields": {
    "issuetype": { "name": "Task" },
    "customfield_10014": "PROJ-1",         ← Epic Link
    "customfield_10016": 3
  }
}
```

### Bug

```json
{
  "fields": {
    "issuetype": { "name": "Bug" },
    "customfield_10014": "PROJ-1",         ← Epic Link (linked to relevant epic)
    "priority":  { "name": "High" }
  }
}
```

### Sub-task (linked to parent Story)

```json
{
  "fields": {
    "issuetype": { "name": "Sub-task" },
    "parent":    { "key": "PROJ-2" },      ← Parent issue key
    "customfield_10016": 1
  }
}
```

Note: Sub-tasks do NOT use Epic Link — they inherit the parent's epic association.

### Spike (Story + label)

```json
{
  "fields": {
    "issuetype": { "name": "Story" },      ← Always Story type for Spikes
    "labels":    ["Spike", "ai-generated"],
    "customfield_10014": "PROJ-1"
  }
}
```

---

## Sprint Assignment

The Sprint field (`customfield_10020`) accepts the sprint **ID** (integer), not name:

```json
{
  "fields": {
    "customfield_10020": 42              ← Sprint ID from jira_get_board
  }
}
```

Alternatively, use `jira_move_to_sprint` after creation.

---

## Acceptance Criteria Storage

If `JIRA_FIELD_ACCEPTANCE_CRITERIA` is configured and the field exists in your project:

```json
{ "customfield_10006": "• Criterion 1\n• Criterion 2" }
```

If the field doesn't exist, AC is included in the description body instead.

---

## How to Find Your Custom Field IDs

```bash
# List all custom fields with their IDs and names
curl -H "Authorization: Bearer $JIRA_PAT" \
     http://localhost:8080/rest/api/2/field \
  | python3 -c "
import json, sys
fields = json.load(sys.stdin)
for f in sorted(fields, key=lambda x: x['id']):
    if f.get('custom'):
        print(f'{f[\"id\"]:30} {f[\"name\"]}')
"
```

### For a specific issue, view all field values:

```bash
curl -H "Authorization: Bearer $JIRA_PAT" \
     "http://localhost:8080/rest/api/2/issue/PROJ-1?expand=names" \
  | python3 -m json.tool | grep -A2 "customfield_"
```

This shows both the field ID and its display name, confirming the mapping.
