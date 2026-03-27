# Tool Schemas — Complete Reference

All 22 MCP tools exposed by the JIRA AI MCP Server.

---

## AI Workflow Tools

### `create_jira_draft`

Store draft artifacts for human review. **Does not write to JIRA.**

```json
{
  "name": "create_jira_draft",
  "inputSchema": {
    "type": "object",
    "required": ["meeting_context", "artifacts"],
    "properties": {
      "project_key": { "type": "string", "default": "PROJ" },
      "meeting_context": { "type": "string" },
      "artifacts": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "required": ["ref", "type", "summary", "description"],
          "properties": {
            "ref": { "type": "string" },
            "type": {
              "type": "string",
              "enum": ["Epic", "Story", "Task", "Bug", "Sub-task", "Spike"]
            },
            "summary": { "type": "string", "maxLength": 255 },
            "description": { "type": "string" },
            "priority": {
              "type": "string",
              "enum": ["Highest", "High", "Medium", "Low", "Lowest"],
              "default": "Medium"
            },
            "storyPoints": {
              "type": "number",
              "enum": [1, 2, 3, 5, 8, 13, 21],
              "default": 3
            },
            "acceptanceCriteria": {
              "type": "array",
              "items": { "type": "string" }
            },
            "labels": { "type": "array", "items": { "type": "string" } },
            "components": { "type": "array", "items": { "type": "string" } },
            "epicRef": { "type": "string" },
            "parentRef": { "type": "string" },
            "epicLinkKey": { "type": "string" },
            "parentKey": { "type": "string" },
            "assigneeId": { "type": "string" },
            "sprintId": { "type": "number" },
            "flaggedForReview": { "type": "boolean" },
            "notes": { "type": "string" }
          }
        }
      }
    }
  }
}
```

---

### `get_jira_draft`

```json
{
  "name": "get_jira_draft",
  "inputSchema": {
    "type": "object",
    "required": ["draft_id"],
    "properties": {
      "draft_id": { "type": "string", "format": "uuid" }
    }
  }
}
```

---

### `list_jira_drafts`

```json
{
  "name": "list_jira_drafts",
  "inputSchema": { "type": "object", "properties": {} }
}
```

---

### `approve_jira_draft`

```json
{
  "name": "approve_jira_draft",
  "inputSchema": {
    "type": "object",
    "required": ["draft_id", "approve"],
    "properties": {
      "draft_id": { "type": "string" },
      "approve": {
        "oneOf": [
          { "type": "string", "enum": ["all"] },
          { "type": "array", "items": { "type": "string" }, "minItems": 1 }
        ]
      }
    }
  }
}
```

---

### `reject_jira_draft`

```json
{
  "name": "reject_jira_draft",
  "inputSchema": {
    "type": "object",
    "required": ["draft_id", "feedback"],
    "properties": {
      "draft_id": { "type": "string" },
      "feedback": { "type": "string" }
    }
  }
}
```

---

### `revise_jira_draft`

```json
{
  "name": "revise_jira_draft",
  "inputSchema": {
    "type": "object",
    "required": ["draft_id", "artifacts"],
    "properties": {
      "draft_id": { "type": "string" },
      "artifacts": {
        "type": "array",
        "items": { "type": "object" },
        "minItems": 1
      }
    }
  }
}
```

---

### `commit_jira_draft`

**Requires prior `approve_jira_draft` call.** Actually creates issues in JIRA.

```json
{
  "name": "commit_jira_draft",
  "inputSchema": {
    "type": "object",
    "required": ["draft_id"],
    "properties": {
      "draft_id": { "type": "string" },
      "refs": {
        "oneOf": [
          { "type": "string", "enum": ["all"] },
          { "type": "array", "items": { "type": "string" } }
        ],
        "default": "all"
      },
      "dry_run": { "type": "boolean", "default": false }
    }
  }
}
```

---

## Issue Tools

### `jira_create_issue`

```json
{
  "name": "jira_create_issue",
  "inputSchema": {
    "type": "object",
    "required": ["issue_type", "summary"],
    "properties": {
      "project_key": { "type": "string" },
      "issue_type": {
        "type": "string",
        "enum": ["Epic", "Story", "Task", "Bug", "Sub-task"]
      },
      "summary": { "type": "string", "maxLength": 255 },
      "description": { "type": "string" },
      "priority": {
        "type": "string",
        "enum": ["Highest", "High", "Medium", "Low", "Lowest"]
      },
      "story_points": { "type": "number", "enum": [1, 2, 3, 5, 8, 13, 21] },
      "labels": { "type": "array", "items": { "type": "string" } },
      "components": { "type": "array", "items": { "type": "string" } },
      "assignee_id": { "type": "string" },
      "parent_key": { "type": "string" },
      "epic_link_key": { "type": "string" }
    }
  }
}
```

### `jira_get_issue`

```json
{
  "required": ["issue_key"],
  "properties": { "issue_key": { "type": "string" } }
}
```

### `jira_update_issue`

```json
{
  "required": ["issue_key"],
  "properties": {
    "issue_key": { "type": "string" },
    "summary": { "type": "string" },
    "description": { "type": "string" },
    "priority": { "type": "string" },
    "story_points": { "type": "number" },
    "labels": { "type": "array", "items": { "type": "string" } },
    "assignee_id": { "type": "string" }
  }
}
```

### `jira_delete_issue`

```json
{
  "required": ["issue_key", "confirmation_phrase"],
  "properties": {
    "issue_key": { "type": "string" },
    "confirmation_phrase": { "type": "string", "const": "DELETE CONFIRMED" }
  }
}
```

### `jira_link_issues`

```json
{
  "required": ["from_key", "to_key", "link_type"],
  "properties": {
    "from_key": { "type": "string" },
    "to_key": { "type": "string" },
    "link_type": {
      "type": "string",
      "enum": [
        "blocks",
        "is blocked by",
        "clones",
        "is cloned by",
        "duplicates",
        "is duplicated by",
        "relates to"
      ]
    }
  }
}
```

### `jira_assign_issue`

```json
{
  "required": ["issue_key", "account_id"],
  "properties": {
    "issue_key": { "type": "string" },
    "account_id": { "type": ["string", "null"] }
  }
}
```

---

## Sprint Tools

### `jira_create_sprint`

```json
{
  "required": ["name", "goal"],
  "properties": {
    "board_id": { "type": "number" },
    "name": { "type": "string" },
    "goal": { "type": "string" },
    "start_date": { "type": "string", "format": "date-time" },
    "end_date": { "type": "string", "format": "date-time" }
  }
}
```

### `jira_update_sprint`

```json
{
  "required": ["sprint_id"],
  "properties": {
    "sprint_id": { "type": "number" },
    "name": { "type": "string" },
    "goal": { "type": "string" },
    "start_date": { "type": "string" },
    "end_date": { "type": "string" },
    "state": { "type": "string", "enum": ["active", "closed", "future"] }
  }
}
```

### `jira_move_to_sprint`

```json
{
  "required": ["sprint_id", "issue_keys"],
  "properties": {
    "sprint_id": { "type": "number" },
    "issue_keys": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 1
    }
  }
}
```

### `jira_get_board`

```json
{ "properties": { "board_id": { "type": "number" } } }
```

---

## Query Tools

### `jira_search_issues`

```json
{
  "required": ["jql"],
  "properties": {
    "jql": { "type": "string" },
    "max_results": { "type": "number", "default": 50, "maximum": 100 },
    "start_at": { "type": "number", "default": 0 }
  }
}
```

### `jira_get_project`

```json
{ "properties": { "project_key": { "type": "string" } } }
```

### `jira_list_users`

```json
{ "properties": { "project_key": { "type": "string" } } }
```

---

## Comment & Workflow Tools

### `jira_add_comment`

```json
{
  "required": ["issue_key", "body"],
  "properties": {
    "issue_key": { "type": "string" },
    "body": { "type": "string" }
  }
}
```

### `jira_get_transitions`

```json
{
  "required": ["issue_key"],
  "properties": { "issue_key": { "type": "string" } }
}
```

### `jira_transition_issue`

```json
{
  "required": ["issue_key", "transition_id"],
  "properties": {
    "issue_key": { "type": "string" },
    "transition_id": { "type": "string" },
    "comment": { "type": "string" }
  }
}
```
