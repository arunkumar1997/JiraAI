import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { jiraClient } from "../jira/client.js";
import { Config } from "../config.js";

export const sprintToolDefinitions: Tool[] = [
  {
    name: "jira_create_sprint",
    description:
      "Create a new sprint on a JIRA Scrum board.\n" +
      "IMPORTANT: Before creating a sprint, ALWAYS call jira_get_board first to show the user existing sprints and board state.",
    inputSchema: {
      type: "object",
      properties: {
        board_id: {
          type: "number",
          description: "Scrum board ID",
          default: Config.jira.boardId,
        },
        name: { type: "string", description: 'Sprint name (e.g. "Sprint 12")' },
        goal: { type: "string", description: "Sprint goal statement" },
        start_date: {
          type: "string",
          description: "ISO 8601 start date (e.g. 2026-03-11T09:00:00.000Z)",
        },
        end_date: { type: "string", description: "ISO 8601 end date" },
      },
      required: ["name", "goal"],
    },
  },
  {
    name: "jira_update_sprint",
    description:
      "Update a sprint: name, goal, dates, or state (active/closed/future).",
    inputSchema: {
      type: "object",
      properties: {
        sprint_id: { type: "number" },
        name: { type: "string" },
        goal: { type: "string" },
        start_date: { type: "string" },
        end_date: { type: "string" },
        state: { type: "string", enum: ["active", "closed", "future"] },
      },
      required: ["sprint_id"],
    },
  },
  {
    name: "jira_move_to_sprint",
    description:
      "Move one or more issues into a sprint.\n" +
      "IMPORTANT: Before moving issues, ALWAYS call jira_get_board to show sprints and jira_search_issues to confirm the issues. Present the report to the user before proceeding.",
    inputSchema: {
      type: "object",
      properties: {
        sprint_id: { type: "number" },
        issue_keys: { type: "array", items: { type: "string" }, minItems: 1 },
      },
      required: ["sprint_id", "issue_keys"],
    },
  },
  {
    name: "jira_get_board",
    description: "Get board configuration and its sprints.",
    inputSchema: {
      type: "object",
      properties: {
        board_id: { type: "number", default: Config.jira.boardId },
      },
    },
  },
];

export async function handleSprintTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (toolName) {
    case "jira_create_sprint": {
      const sprint = await jiraClient.createSprint(
        (args.board_id as number) || Config.jira.boardId,
        args.name as string,
        args.goal as string,
        args.start_date as string | undefined,
        args.end_date as string | undefined,
      );
      return `✅ Sprint created: [${sprint.id}] ${sprint.name}`;
    }

    case "jira_update_sprint": {
      const sprint = await jiraClient.updateSprint(args.sprint_id as number, {
        name: args.name as string | undefined,
        goal: args.goal as string | undefined,
        startDate: args.start_date as string | undefined,
        endDate: args.end_date as string | undefined,
        state: args.state as "active" | "closed" | "future" | undefined,
      });
      return `✅ Sprint updated: [${sprint.id}] ${sprint.name} (${sprint.state})`;
    }

    case "jira_move_to_sprint": {
      const keys = args.issue_keys as string[];
      await jiraClient.moveIssuesToSprint(args.sprint_id as number, keys);
      return `✅ Moved ${keys.length} issue(s) to sprint ${args.sprint_id as number}: ${keys.join(", ")}`;
    }

    case "jira_get_board": {
      const boardId = (args.board_id as number) || Config.jira.boardId;
      const [board, sprints] = await Promise.all([
        jiraClient.getBoard(boardId),
        jiraClient.getBoardSprints(boardId),
      ]);
      return JSON.stringify({ board, sprints }, null, 2);
    }

    default:
      throw new Error(`Unknown sprint tool: ${toolName}`);
  }
}
