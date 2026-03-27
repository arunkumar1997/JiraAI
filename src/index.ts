#!/usr/bin/env node
/**
 * JIRA AI MCP Server — Entry Point
 *
 * Registers all MCP tools and connects via stdio transport.
 * Configure with Claude Desktop by pointing to this script after `npm run build`.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { logger } from "./utils/logger.js";
import { Config } from "./config.js";

import { draftToolDefinitions, handleDraftTool } from "./tools/draft-tools.js";
import { issueToolDefinitions, handleIssueTool } from "./tools/issue-tools.js";
import {
  sprintToolDefinitions,
  handleSprintTool,
} from "./tools/sprint-tools.js";
import {
  searchToolDefinitions,
  handleSearchTool,
} from "./tools/search-tools.js";
import {
  commentToolDefinitions,
  handleCommentTool,
} from "./tools/comment-tools.js";
import {
  workflowToolDefinitions,
  handleWorkflowTool,
} from "./tools/workflow-tools.js";
import {
  transcriptionToolDefinitions,
  handleTranscriptionTool,
} from "./tools/transcription-tools.js";

// ─── Server Instructions ──────────────────────────────────────────────────────
// Embedded in the MCP initialize response — every AI client will receive these.

const SERVER_INSTRUCTIONS = `You are an Agile Scrum Orchestrator powered by a JIRA MCP server. You MUST follow these rules at all times.

## MANDATORY RULES (NON-NEGOTIABLE)

### Rule 1 — ALWAYS use the Draft Workflow for creating issues
Every request to create JIRA issues MUST go through this exact sequence:
  1. Call \`create_jira_draft\` with all structured artifacts
  2. Present the FULL review summary to the user (the tool returns a formatted summary — show it verbatim)
  3. STOP and WAIT for the user's explicit decision (approve / reject / modify)
  4. Only after approval, call \`commit_jira_draft\`
NEVER skip steps 2–3. NEVER auto-approve. NEVER call commit_jira_draft without approval.

### Rule 2 — ALWAYS show reports before taking action
Before ANY modification to JIRA, first fetch and show the current state:
  - Before creating issues → call \`jira_search_issues\` to show existing backlog
  - Before updating an issue → call \`jira_get_issue\` to show current fields
  - Before transitioning → call \`jira_get_transitions\` to show available transitions
  - Before sprint operations → call \`jira_get_board\` to show board and sprints
  - Before assigning → call \`jira_list_users\` to show available users
Present the report to the user, then proceed with the action.

### Rule 3 — ALWAYS present the draft for approval
After calling \`create_jira_draft\`, you MUST:
  1. Display the full formatted review summary (with all artifacts, acceptance criteria, story points)
  2. Explicitly ask: "Please review and respond with: APPROVE ALL, APPROVE [specific refs], or REJECT with feedback"
  3. Do NOT proceed until the user responds

### Rule 4 — Error handling
If a JIRA API call returns an error, report it clearly to the user. Do NOT auto-retry. Do NOT silently skip.

### Rule 5 — Direct issue creation (\`jira_create_issue\`) is only for single quick issues
For meeting notes, transcripts, requirements, or any batch of work items, ALWAYS use the draft workflow (Rule 1).

## SCRUM PROCESS AUTOMATION
| Event | Your Action |
|-------|-------------|
| Sprint Planning | Search backlog → present current state → propose draft with prioritized items → wait for approval |
| Standup | Parse notes → show current issue statuses → propose transitions → wait for approval |
| Sprint Review | JQL search for completed/incomplete → calculate velocity → present report |
| Retrospective | Analyze patterns → create improvement Tasks via draft workflow → wait for approval |
| Backlog Refinement | Search stale items → propose re-estimates via draft → wait for approval |

## QUALITY REQUIREMENTS
Every artifact in a draft MUST include: acceptanceCriteria (min 3), testingScenarios (min 2), edgeCases (min 2), possibleBugs (min 1), structured description, priority justification, and story points.`;

// ─── Tool Registry ────────────────────────────────────────────────────────────

const ALL_TOOLS: Tool[] = [
  ...draftToolDefinitions, // AI workflow (create/approve/commit draft)
  ...issueToolDefinitions, // CRUD issues
  ...sprintToolDefinitions, // Sprint management
  ...searchToolDefinitions, // JQL search, project/user queries
  ...commentToolDefinitions, // Issue comments
  ...workflowToolDefinitions, // Status transitions
  ...transcriptionToolDefinitions, // Local meeting transcription (on-device, no data leaves machine)
];

type Handler = (name: string, args: Record<string, unknown>) => Promise<string>;

const ROUTER: Record<string, Handler> = {
  // Draft / AI workflow
  create_jira_draft: handleDraftTool,
  get_jira_draft: handleDraftTool,
  list_jira_drafts: handleDraftTool,
  approve_jira_draft: handleDraftTool,
  reject_jira_draft: handleDraftTool,
  revise_jira_draft: handleDraftTool,
  commit_jira_draft: handleDraftTool,

  // Direct issue operations
  jira_create_issue: handleIssueTool,
  jira_get_issue: handleIssueTool,
  jira_update_issue: handleIssueTool,
  jira_delete_issue: handleIssueTool,
  jira_link_issues: handleIssueTool,
  jira_assign_issue: handleIssueTool,

  // Sprint management
  jira_create_sprint: handleSprintTool,
  jira_update_sprint: handleSprintTool,
  jira_move_to_sprint: handleSprintTool,
  jira_get_board: handleSprintTool,

  // Search & project info
  jira_search_issues: handleSearchTool,
  jira_get_project: handleSearchTool,
  jira_list_users: handleSearchTool,

  // Comments
  jira_add_comment: handleCommentTool,

  // Workflow transitions
  jira_get_transitions: handleWorkflowTool,
  jira_transition_issue: handleWorkflowTool,

  // Local meeting transcription (on-device Whisper — no audio sent externally)
  transcribe_meeting: handleTranscriptionTool,
  start_transcription: handleTranscriptionTool, // long recordings — returns immediately
  get_transcription_result: handleTranscriptionTool, // poll for background job result
};

// ─── Server Bootstrap ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const server = new Server(
    { name: Config.server.name, version: Config.server.version },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS,
  }));

  // Dispatch tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    const handler = ROUTER[name];
    if (!handler) {
      return {
        content: [{ type: "text", text: `❌ Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      logger.info("Tool call", { tool: name });
      const result = await handler(name, args);
      logger.info("Tool success", { tool: name });
      return { content: [{ type: "text", text: result }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Tool error", { tool: name, error: message });
      return {
        content: [{ type: "text", text: `❌ ${name} failed: ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("JIRA AI MCP Server ready", {
    jiraUrl: Config.jira.baseUrl,
    project: Config.jira.projectKey,
    tools: ALL_TOOLS.length,
  });
}

main().catch((err: unknown) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
