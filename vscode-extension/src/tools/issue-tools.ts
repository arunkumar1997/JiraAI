import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { jiraClient } from "../jira/client";
import { Config } from "../config";
import type { IssuePriority } from "../jira/types";

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const issueToolDefinitions: Tool[] = [
  {
    name: "jira_create_issue",
    description:
      "Create a single JIRA issue directly. For bulk creation from meeting notes, use create_jira_draft instead.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string", default: Config.jira.projectKey },
        issue_type: {
          type: "string",
          enum: ["Epic", "Story", "Task", "Bug", "Sub-task"],
        },
        summary: { type: "string", maxLength: 255 },
        description: { type: "string" },
        priority: {
          type: "string",
          enum: ["Highest", "High", "Medium", "Low", "Lowest"],
          default: "Medium",
        },
        story_points: { type: "number", enum: [1, 2, 3, 5, 8, 13, 21] },
        labels: { type: "array", items: { type: "string" } },
        components: { type: "array", items: { type: "string" } },
        assignee_id: { type: "string", description: "JIRA account ID" },
        parent_key: {
          type: "string",
          description: "Parent key for Sub-tasks",
        },
        epic_link_key: {
          type: "string",
          description: "Epic key to link this issue to",
        },
      },
      required: ["issue_type", "summary"],
    },
  },
  {
    name: "jira_get_issue",
    description: "Fetch full details of a JIRA issue by its key.",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: {
          type: "string",
          description: "Issue key (e.g. PROJ-42)",
        },
      },
      required: ["issue_key"],
    },
  },
  {
    name: "jira_update_issue",
    description: "Update fields on an existing JIRA issue.",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: { type: "string" },
        summary: { type: "string" },
        description: { type: "string" },
        priority: {
          type: "string",
          enum: ["Highest", "High", "Medium", "Low", "Lowest"],
        },
        story_points: { type: "number", enum: [1, 2, 3, 5, 8, 13, 21] },
        labels: { type: "array", items: { type: "string" } },
        assignee_id: { type: "string" },
      },
      required: ["issue_key"],
    },
  },
  {
    name: "jira_delete_issue",
    description:
      'Permanently delete a JIRA issue. SAFETY: confirmation_phrase must be the exact string "DELETE CONFIRMED" or the deletion is refused.',
    inputSchema: {
      type: "object",
      properties: {
        issue_key: { type: "string" },
        confirmation_phrase: {
          type: "string",
          description: 'Must be exactly "DELETE CONFIRMED"',
        },
      },
      required: ["issue_key", "confirmation_phrase"],
    },
  },
  {
    name: "jira_link_issues",
    description: "Create a link relationship between two JIRA issues.",
    inputSchema: {
      type: "object",
      properties: {
        from_key: { type: "string" },
        to_key: { type: "string" },
        link_type: {
          type: "string",
          enum: [
            "blocks",
            "is blocked by",
            "clones",
            "is cloned by",
            "duplicates",
            "is duplicated by",
            "relates to",
          ],
          default: "relates to",
        },
      },
      required: ["from_key", "to_key", "link_type"],
    },
  },
  {
    name: "jira_assign_issue",
    description:
      "Assign a JIRA issue to a user. Use jira_list_users to find account IDs.",
    inputSchema: {
      type: "object",
      properties: {
        issue_key: { type: "string" },
        account_id: {
          type: ["string", "null"],
          description:
            "User account ID from jira_list_users, or null to unassign",
        },
      },
      required: ["issue_key", "account_id"],
    },
  },
];

// ─── Tool Handlers ────────────────────────────────────────────────────────────

export async function handleIssueTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { fields } = Config.jira;

  switch (toolName) {
    case "jira_create_issue": {
      const issueFields: Record<string, unknown> = {
        summary: args.summary,
        issuetype: { name: args.issue_type },
        project: {
          key: (args.project_key as string) || Config.jira.projectKey,
        },
        priority: { name: (args.priority as string) || "Medium" },
      };
      if (args.description) issueFields.description = args.description;
      if (args.story_points)
        issueFields[fields.storyPoints] = args.story_points;
      if (args.labels) issueFields.labels = args.labels;
      if (args.components)
        issueFields.components = (args.components as string[]).map((n) => ({
          name: n,
        }));
      if (args.assignee_id)
        issueFields.assignee = { accountId: args.assignee_id };
      if (args.parent_key) issueFields.parent = { key: args.parent_key };
      if (args.epic_link_key) issueFields[fields.epicLink] = args.epic_link_key;

      const issue = await jiraClient.createIssue(issueFields as never);
      return `✅ Created: ${issue.key} — ${issue.fields.summary}`;
    }

    case "jira_get_issue": {
      const issue = await jiraClient.getIssue(args.issue_key as string);
      return JSON.stringify(
        {
          key: issue.key,
          summary: issue.fields.summary,
          type: issue.fields.issuetype.name,
          status: issue.fields.status.name,
          priority: issue.fields.priority?.name,
          assignee: issue.fields.assignee?.displayName ?? "Unassigned",
          labels: issue.fields.labels,
          created: issue.fields.created,
          updated: issue.fields.updated,
        },
        null,
        2,
      );
    }

    case "jira_update_issue": {
      const update: Record<string, unknown> = {};
      if (args.summary) update.summary = args.summary;
      if (args.description) update.description = args.description;
      if (args.priority)
        update.priority = { name: args.priority as IssuePriority };
      if (args.story_points) update[fields.storyPoints] = args.story_points;
      if (args.labels) update.labels = args.labels;
      if (args.assignee_id) update.assignee = { accountId: args.assignee_id };
      await jiraClient.updateIssue(args.issue_key as string, update as never);
      return `✅ Updated: ${args.issue_key as string}`;
    }

    case "jira_delete_issue": {
      if (args.confirmation_phrase !== "DELETE CONFIRMED") {
        return (
          `❌ Deletion REFUSED — confirmation_phrase must be exactly "DELETE CONFIRMED".\n` +
          `Issue ${args.issue_key as string} was NOT deleted.`
        );
      }
      await jiraClient.deleteIssue(args.issue_key as string);
      return `🗑️  Issue ${args.issue_key as string} permanently deleted.`;
    }

    case "jira_link_issues": {
      await jiraClient.linkIssues(
        args.from_key as string,
        args.to_key as string,
        args.link_type as string,
      );
      return `🔗 Linked: ${args.from_key as string} → "${args.link_type as string}" → ${args.to_key as string}`;
    }

    case "jira_assign_issue": {
      await jiraClient.assignIssue(
        args.issue_key as string,
        args.account_id as string | null,
      );
      const assignee = args.account_id
        ? `account ${args.account_id as string}`
        : "unassigned";
      return `👤 ${args.issue_key as string} → ${assignee}`;
    }

    default:
      throw new Error(`Unknown issue tool: ${toolName}`);
  }
}
