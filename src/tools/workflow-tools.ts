import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { jiraClient } from "../jira/client.js";

export const workflowToolDefinitions: Tool[] = [
  {
    name: "jira_get_transitions",
    description:
      "Get all available workflow transitions for a JIRA issue. " +
      "Use the returned transition IDs with jira_transition_issue.",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: { type: "string", description: "Issue key (e.g. PROJ-42)" },
      },
      required: ["issue_key"],
    },
  },
  {
    name: "jira_transition_issue",
    description:
      "Move a JIRA issue to a new workflow status. " +
      "IMPORTANT: You MUST first call jira_get_transitions to find the transition ID, then show the user the available transitions and current status before proceeding.",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: { type: "string", description: "Issue key" },
        transition_id: {
          type: "string",
          description: "Transition ID from jira_get_transitions",
        },
        comment: {
          type: "string",
          description: "Optional comment to add when transitioning",
        },
      },
      required: ["issue_key", "transition_id"],
    },
  },
];

export async function handleWorkflowTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (toolName) {
    case "jira_get_transitions": {
      const transitions = await jiraClient.getTransitions(
        args.issue_key as string,
      );
      return JSON.stringify(
        transitions.map((t) => ({
          id: t.id,
          name: t.name,
          toStatus: t.to.name,
        })),
        null,
        2,
      );
    }

    case "jira_transition_issue": {
      await jiraClient.transitionIssue(
        args.issue_key as string,
        args.transition_id as string,
        args.comment as string | undefined,
      );
      return (
        `🔄 ${args.issue_key as string} transitioned via ID ${args.transition_id as string}` +
        (args.comment ? ` with comment added.` : `.`)
      );
    }

    default:
      throw new Error(`Unknown workflow tool: ${toolName}`);
  }
}
