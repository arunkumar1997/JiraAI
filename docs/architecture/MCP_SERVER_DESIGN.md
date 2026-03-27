# MCP Server Design

## What is MCP?

Model Context Protocol (MCP) is an open standard by Anthropic that lets AI assistants call external tools and data sources in a structured, composable way. The protocol uses JSON-RPC 2.0 over stdio (or HTTP+SSE).

This server implements the **tool provider** side of MCP.

---

## Protocol Flow

```
Claude (MCP host)                    JIRA AI MCP Server
     │                                       │
     │── initialize ─────────────────────────►│
     │◄─ initialized ──────────────────────── │
     │                                       │
     │── tools/list ────────────────────────►│
     │◄─ { tools: [...22 tools] } ─────────── │
     │                                       │
     │── tools/call { name, arguments } ────►│
     │◄─ { content: [{ type: text, ... }] } ─│
     │                                       │
```

Transport: **stdio** (stdin/stdout JSON-RPC). Each message is newline-delimited JSON.

---

## Server Structure

```
Server (sdk/server)
└── StdioServerTransport
    ├── ListToolsRequestSchema handler → returns ALL_TOOLS[]
    └── CallToolRequestSchema handler  → dispatches via ROUTER map
        ├── handleDraftTool(name, args)
        ├── handleIssueTool(name, args)
        ├── handleSprintTool(name, args)
        ├── handleSearchTool(name, args)
        ├── handleCommentTool(name, args)
        └── handleWorkflowTool(name, args)
```

---

## Tool Categories

### 1. AI Workflow Tools (Draft Lifecycle)

| Tool                 | Direction | Description                                           |
| -------------------- | --------- | ----------------------------------------------------- |
| `create_jira_draft`  | Write     | Store analyzed artifacts as a draft                   |
| `get_jira_draft`     | Read      | Fetch and display a draft                             |
| `list_jira_drafts`   | Read      | List all drafts                                       |
| `approve_jira_draft` | Write     | Mark draft as approved                                |
| `reject_jira_draft`  | Write     | Reject with feedback                                  |
| `revise_jira_draft`  | Write     | Update artifacts after rejection                      |
| `commit_jira_draft`  | Write     | **Actually commit to JIRA** (requires prior approval) |

### 2. Issue Tools

| Tool                | Direction       |
| ------------------- | --------------- |
| `jira_create_issue` | Write           |
| `jira_get_issue`    | Read            |
| `jira_update_issue` | Write           |
| `jira_delete_issue` | Write (guarded) |
| `jira_link_issues`  | Write           |
| `jira_assign_issue` | Write           |

### 3. Sprint Tools

| Tool                  | Direction |
| --------------------- | --------- |
| `jira_create_sprint`  | Write     |
| `jira_update_sprint`  | Write     |
| `jira_move_to_sprint` | Write     |
| `jira_get_board`      | Read      |

### 4. Query Tools

| Tool                 | Direction |
| -------------------- | --------- |
| `jira_search_issues` | Read      |
| `jira_get_project`   | Read      |
| `jira_list_users`    | Read      |

### 5. Comment & Workflow Tools

| Tool                    | Direction |
| ----------------------- | --------- |
| `jira_add_comment`      | Write     |
| `jira_get_transitions`  | Read      |
| `jira_transition_issue` | Write     |

---

## Tool Response Format

All tools return `{ content: [{ type: "text", text: "..." }] }`.

- **Success**: human-readable text with emoji indicators (✅ ❌ 🔗 💬 🔄)
- **Error**: `isError: true` + descriptive message (never raw stack traces)
- **Review summary**: structured multi-line text report (for draft tools)

---

## Approval State Machine

```
                    create_jira_draft
                          │
                          ▼
                   ┌─────────────┐
                   │pending_review│◄──────────────────┐
                   └──────┬──────┘                    │
                          │                           │
              ┌───────────┼──────────┐                │
              ▼           ▼          ▼                │
         ┌────────┐  ┌────────┐  ┌────────┐           │
         │approved│  │partial │  │rejected│───revise──┘
         └───┬────┘  └───┬────┘  └────────┘
             │           │
             └─────┬─────┘
                   ▼
             commit_jira_draft
                   │
                   ▼
              ┌─────────┐
              │committed│
              └─────────┘
```

`commit_jira_draft` is blocked unless status is `approved` or `partial`.  
This is enforced in `DraftManager.markCommitted()` — not just in the tool handler.

---

## Adding a New Tool

1. Add a `Tool` definition object to the appropriate `*-tools.ts` file:

```typescript
{
  name: 'my_new_tool',
  description: '...',
  inputSchema: {
    type: 'object',
    properties: { ... },
    required: ['...'],
  },
}
```

2. Add the handler case in the same file's `handle*Tool()` function.

3. Register in `src/index.ts`:

```typescript
// In ALL_TOOLS array:
...myToolDefinitions,

// In ROUTER map:
my_new_tool: handleMyTool,
```

No other files need to change.

---

## Claude Desktop Configuration

`~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jira-ai": {
      "command": "node",
      "args": ["/home/arun/jiraAI/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "http://localhost:8080",
        "JIRA_PAT": "your-personal-access-token",
        "JIRA_PROJECT_KEY": "PROJ",
        "JIRA_BOARD_ID": "1"
      }
    }
  }
}
```

For development (without building):

```json
{
  "command": "npx",
  "args": ["tsx", "/home/arun/jiraAI/src/index.ts"]
}
```
