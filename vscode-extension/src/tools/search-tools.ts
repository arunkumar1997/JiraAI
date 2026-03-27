import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { jiraClient } from "../jira/client";
import { Config } from "../config";

export const searchToolDefinitions: Tool[] = [
  {
    name: "jira_search_issues",
    description:
      "Search JIRA issues using JQL. Examples:\n" +
      '  "project = PROJ AND issuetype = Story AND status = Open"\n' +
      '  "sprint in openSprints() AND assignee = currentUser()"\n' +
      '  "issuetype = Bug AND priority in (High, Highest) ORDER BY created DESC"',
    inputSchema: {
      type: "object",
      properties: {
        jql: { type: "string", description: "JQL query string" },
        max_results: { type: "number", default: 50, maximum: 100 },
        start_at: { type: "number", default: 0 },
      },
      required: ["jql"],
    },
  },
  {
    name: "jira_get_project",
    description:
      "Retrieve project metadata: issue types, components, and configuration.",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string", default: Config.jira.projectKey },
      },
    },
  },
  {
    name: "jira_list_users",
    description:
      "List users assignable in a project (returns accountId, name, email).",
    inputSchema: {
      type: "object",
      properties: {
        project_key: { type: "string", default: Config.jira.projectKey },
      },
    },
  },
];

export async function handleSearchTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (toolName) {
    case "jira_search_issues": {
      const result = await jiraClient.searchIssues(
        args.jql as string,
        (args.max_results as number) || 50,
        (args.start_at as number) || 0,
      );
      return JSON.stringify(
        {
          total: result.total,
          returned: result.issues.length,
          issues: result.issues.map((i) => ({
            key: i.key,
            type: i.fields.issuetype.name,
            status: i.fields.status.name,
            priority: i.fields.priority?.name,
            assignee: i.fields.assignee?.displayName ?? "Unassigned",
            summary: i.fields.summary,
            updated: i.fields.updated,
          })),
        },
        null,
        2,
      );
    }

    case "jira_get_project": {
      const project = await jiraClient.getProject(
        (args.project_key as string) || Config.jira.projectKey,
      );
      return JSON.stringify(project, null, 2);
    }

    case "jira_list_users": {
      const users = await jiraClient.listAssignableUsers(
        (args.project_key as string) || Config.jira.projectKey,
      );
      return JSON.stringify(
        users.map((u) => ({
          accountId: u.accountId,
          name: u.displayName,
          email: u.emailAddress,
          active: u.active,
        })),
        null,
        2,
      );
    }

    default:
      throw new Error(`Unknown search tool: ${toolName}`);
  }
}
