# JIRA AI MCP Server — VS Code Extension

AI-powered JIRA workflow automation as a VS Code MCP server. Transforms meeting summaries into JIRA artifacts with human-in-the-loop approval using GitHub Copilot.

## Features

- **Draft workflow** — Analyze meeting notes → create draft → review → approve → commit to JIRA
- **Issue management** — Create, update, delete, link, and assign JIRA issues
- **Sprint management** — Create sprints, move issues, update sprint details
- **JQL search** — Search issues with full JQL support
- **Workflow transitions** — Get and apply JIRA workflow transitions
- **Comments** — Add comments with JIRA wiki markup
- **Meeting transcription** — Local Whisper-based transcription (no data leaves your machine)

## Requirements

- VS Code 1.99 or later
- GitHub Copilot extension
- A JIRA instance (Cloud or Data Center)
- A JIRA Personal Access Token (PAT)
- Node.js 18+ (for the MCP server subprocess)

## Setup

1. Install this extension
2. Open **Settings** → search for `JIRA AI MCP`
3. Set your **JIRA Base URL** (e.g. `https://mycompany.atlassian.net`)
4. Set your **JIRA PAT** (Personal Access Token)
5. Set your **Project Key** and **Board ID**
6. Open GitHub Copilot Chat — the JIRA AI tools are now available!

## Configuration

| Setting                      | Default                 | Description                               |
| ---------------------------- | ----------------------- | ----------------------------------------- |
| `jiraAiMcp.baseUrl`          | `http://localhost:8080` | JIRA base URL                             |
| `jiraAiMcp.pat`              | _(empty)_               | JIRA Personal Access Token                |
| `jiraAiMcp.projectKey`       | `PROJ`                  | Default project key                       |
| `jiraAiMcp.boardId`          | `1`                     | Default Scrum board ID                    |
| `jiraAiMcp.storyPointsField` | `customfield_10016`     | Story points custom field ID              |
| `jiraAiMcp.epicLinkField`    | `customfield_10014`     | Epic link custom field ID                 |
| `jiraAiMcp.epicNameField`    | `customfield_10011`     | Epic name custom field ID                 |
| `jiraAiMcp.sprintField`      | `customfield_10020`     | Sprint custom field ID                    |
| `jiraAiMcp.logLevel`         | `info`                  | Server log level                          |
| `jiraAiMcp.whisperPython`    | _(empty)_               | Python path with faster-whisper installed |

## Available Tools

### Draft Workflow (Human-in-the-Loop)

| Tool                 | Description                                            |
| -------------------- | ------------------------------------------------------ |
| `create_jira_draft`  | Parse meeting notes → staged JIRA artifacts for review |
| `get_jira_draft`     | Retrieve a draft by ID                                 |
| `list_jira_drafts`   | List all drafts                                        |
| `approve_jira_draft` | Approve all or specific artifacts                      |
| `reject_jira_draft`  | Reject with feedback for revision                      |
| `revise_jira_draft`  | Update artifacts after rejection                       |
| `commit_jira_draft`  | Commit approved artifacts to JIRA                      |

### Issue Operations

| Tool                | Description                             |
| ------------------- | --------------------------------------- |
| `jira_create_issue` | Create a single issue                   |
| `jira_get_issue`    | Get issue details                       |
| `jira_update_issue` | Update issue fields                     |
| `jira_delete_issue` | Delete an issue (requires confirmation) |
| `jira_link_issues`  | Create issue links                      |
| `jira_assign_issue` | Assign/unassign an issue                |

### Sprint & Board

| Tool                  | Description               |
| --------------------- | ------------------------- |
| `jira_create_sprint`  | Create a new sprint       |
| `jira_update_sprint`  | Update sprint details     |
| `jira_move_to_sprint` | Move issues to a sprint   |
| `jira_get_board`      | Get board and sprint list |

### Search & Discovery

| Tool                 | Description           |
| -------------------- | --------------------- |
| `jira_search_issues` | Search with JQL       |
| `jira_get_project`   | Get project metadata  |
| `jira_list_users`    | List assignable users |

### Workflow

| Tool                    | Description               |
| ----------------------- | ------------------------- |
| `jira_get_transitions`  | Get available transitions |
| `jira_transition_issue` | Move to a new status      |
| `jira_add_comment`      | Add a comment             |

### Meeting Transcription (local, on-device)

| Tool                       | Description                                      |
| -------------------------- | ------------------------------------------------ |
| `transcribe_meeting`       | Transcribe a short recording synchronously       |
| `start_transcription`      | Start background transcription (long recordings) |
| `get_transcription_result` | Poll for background job result                   |

**Prerequisite for transcription:** `pip install faster-whisper`

## Example Copilot Chat Usage

```
@copilot I have meeting notes from our sprint planning. Can you create JIRA stories?

[paste meeting notes]
```

Copilot will call `create_jira_draft`, show you the draft for review, and once you approve, call `commit_jira_draft` to push everything to JIRA.

## Draft Storage

Drafts are persisted to `~/.jira-ai-mcp/.drafts.json` and survive across sessions.

## Local JIRA Setup

For local development with a JIRA Data Center instance, refer to the [LOCAL_JIRA_SETUP.md](https://github.com/your-org/jiraAI/blob/main/docs/setup/LOCAL_JIRA_SETUP.md) guide in the main repo.

## Security

- PAT is stored in VS Code's secure settings storage
- All JIRA API calls use Bearer token authentication
- Transcription runs entirely on-device via Whisper
- Delete operations require an explicit `"DELETE CONFIRMED"` phrase

## License

MIT
