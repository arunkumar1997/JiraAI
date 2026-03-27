#!/usr/bin/env node
/**
 * JIRA AI MCP Server — Entry Point (VS Code Extension build)
 *
 * This file is bundled by esbuild into dist/server.js and launched by VS Code
 * as a managed MCP subprocess. All configuration is received via environment
 * variables set in contributes.mcpServerDefinitions.env.
 *
 * stdout → MCP JSON-RPC protocol messages
 * stderr → diagnostic logs (captured by VS Code)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { logger } from "./utils/logger";
import { Config } from "./config";

import { draftToolDefinitions, handleDraftTool } from "./tools/draft-tools";
import { issueToolDefinitions, handleIssueTool } from "./tools/issue-tools";
import { sprintToolDefinitions, handleSprintTool } from "./tools/sprint-tools";
import { searchToolDefinitions, handleSearchTool } from "./tools/search-tools";
import {
  commentToolDefinitions,
  handleCommentTool,
} from "./tools/comment-tools";
import {
  workflowToolDefinitions,
  handleWorkflowTool,
} from "./tools/workflow-tools";
import {
  transcriptionToolDefinitions,
  handleTranscriptionTool,
} from "./tools/transcription-tools";

// ─── Tool Registry ─────────────────────────────────────────────────────────────

const ALL_TOOLS: Tool[] = [
  ...draftToolDefinitions,
  ...issueToolDefinitions,
  ...sprintToolDefinitions,
  ...searchToolDefinitions,
  ...commentToolDefinitions,
  ...workflowToolDefinitions,
  ...transcriptionToolDefinitions,
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

  // Local meeting transcription
  transcribe_meeting: handleTranscriptionTool,
  start_transcription: handleTranscriptionTool,
  get_transcription_result: handleTranscriptionTool,
};

// ─── Server Bootstrap ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const server = new Server(
    { name: Config.server.name, version: Config.server.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const handler = ROUTER[name];

    if (!handler) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
      };
    }

    try {
      logger.info(`Tool invoked: ${name}`);
      const result = await handler(name, args as Record<string, unknown>);
      return { content: [{ type: "text" as const, text: result }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Tool error [${name}]: ${message}`);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${message}` }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`JIRA AI MCP server started (${Config.server.version})`);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[FATAL] ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
