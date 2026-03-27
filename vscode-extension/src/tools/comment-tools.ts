import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { jiraClient } from "../jira/client";

export const commentToolDefinitions: Tool[] = [
  {
    name: "jira_add_comment",
    description: "Add a comment to a JIRA issue. Supports JIRA wiki markup.",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g. PROJ-42)",
        },
        body: {
          type: "string",
          description:
            "Comment body. Supports JIRA wiki markup:\n" +
            "  *bold*, _italic_, {{monospace}}\n" +
            "  # heading, * list item\n" +
            "  {code}...{code} for code blocks",
        },
      },
      required: ["issue_key", "body"],
    },
  },
];

export async function handleCommentTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (toolName) {
    case "jira_add_comment": {
      await jiraClient.addComment(
        args.issue_key as string,
        args.body as string,
      );
      return `💬 Comment added to ${args.issue_key as string}`;
    }

    default:
      throw new Error(`Unknown comment tool: ${toolName}`);
  }
}
