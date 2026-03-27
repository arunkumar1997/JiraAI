/**
 * Unit tests for issue-tools handleIssueTool.
 * All Jira REST calls are mocked via jest.unstable_mockModule.
 */
import { jest } from "@jest/globals";

jest.unstable_mockModule("../../config.js", () => ({
  Config: {
    jira: {
      baseUrl: "http://localhost:8080",
      pat: "test-pat",
      projectKey: "TEST",
      boardId: 1,
      fields: {
        storyPoints: "customfield_10016",
        epicLink: "customfield_10014",
        epicName: "customfield_10011",
        sprint: "customfield_10020",
        acceptanceCriteria: "customfield_10006",
      },
    },
    logging: { level: "silent", file: "" },
    draftStoragePath: "/tmp/test.json",
    server: { name: "test", version: "1.0.0" },
  },
}));

jest.unstable_mockModule("../../utils/logger.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockCreateIssue: jest.Mock = jest.fn();
const mockGetIssue: jest.Mock = jest.fn();
const mockUpdateIssue: jest.Mock = jest.fn();
const mockDeleteIssue: jest.Mock = jest.fn();
const mockLinkIssues: jest.Mock = jest.fn();
const mockAssignIssue: jest.Mock = jest.fn();

jest.unstable_mockModule("../../jira/client.js", () => ({
  jiraClient: {
    createIssue: mockCreateIssue,
    getIssue: mockGetIssue,
    updateIssue: mockUpdateIssue,
    deleteIssue: mockDeleteIssue,
    linkIssues: mockLinkIssues,
    assignIssue: mockAssignIssue,
  },
}));

const { handleIssueTool } = await import("../../tools/issue-tools.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIssue(key: string) {
  return {
    id: "1",
    key,
    self: `http://localhost/issue/${key}`,
    fields: {
      summary: "Test issue",
      description: "",
      issuetype: { id: "1", name: "Story", subtask: false },
      status: {
        name: "To Do",
        statusCategory: { id: 1, key: "new", name: "To Do" },
      },
      priority: { name: "Medium" as const },
      assignee: null,
      reporter: undefined,
      labels: [],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
  };
}

beforeEach(() => jest.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleIssueTool — jira_create_issue", () => {
  it("creates an issue and returns success string", async () => {
    mockCreateIssue.mockResolvedValueOnce(makeIssue("TEST-1"));

    const result = await handleIssueTool("jira_create_issue", {
      summary: "Implement login",
      issue_type: "Story",
      description: "Users should be able to log in",
    });

    expect(mockCreateIssue).toHaveBeenCalledTimes(1);
    expect(result).toContain("TEST-1");
    expect(result).toContain("Created");
  });

  it("includes priority field when provided", async () => {
    mockCreateIssue.mockResolvedValueOnce(makeIssue("TEST-2"));

    await handleIssueTool("jira_create_issue", {
      summary: "Epic feature",
      issue_type: "Epic",
      priority: "High",
    });

    const callArgs = mockCreateIssue.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs["priority"]).toMatchObject({ name: "High" });
  });

  it("uses configured projectKey when project_key is omitted", async () => {
    mockCreateIssue.mockResolvedValueOnce(makeIssue("TEST-3"));

    await handleIssueTool("jira_create_issue", {
      summary: "No project key",
      issue_type: "Task",
    });

    const callArgs = mockCreateIssue.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs["project"]).toMatchObject({ key: "TEST" });
  });
});

describe("handleIssueTool — jira_get_issue", () => {
  it("returns JSON with issue details", async () => {
    mockGetIssue.mockResolvedValueOnce(makeIssue("TEST-42"));

    const result = await handleIssueTool("jira_get_issue", { issue_key: "TEST-42" });

    expect(mockGetIssue).toHaveBeenCalledWith("TEST-42");
    const parsed = JSON.parse(result as string);
    expect(parsed.key).toBe("TEST-42");
    expect(parsed.summary).toBe("Test issue");
  });
});

describe("handleIssueTool — jira_update_issue", () => {
  it("updates fields and returns confirmation string", async () => {
    mockUpdateIssue.mockResolvedValueOnce(undefined);

    const result = await handleIssueTool("jira_update_issue", {
      issue_key: "TEST-5",
      summary: "Updated summary",
      story_points: 5,
    });

    expect(mockUpdateIssue).toHaveBeenCalledWith(
      "TEST-5",
      expect.objectContaining({ summary: "Updated summary" }),
    );
    expect(result).toContain("Updated");
    expect(result).toContain("TEST-5");
  });
});

describe("handleIssueTool — jira_delete_issue", () => {
  it("refuses without exact confirmation phrase", async () => {
    const result = await handleIssueTool("jira_delete_issue", {
      issue_key: "TEST-99",
    });

    expect(mockDeleteIssue).not.toHaveBeenCalled();
    expect(result).toContain("REFUSED");
  });

  it("refuses when confirmation phrase is wrong", async () => {
    const result = await handleIssueTool("jira_delete_issue", {
      issue_key: "TEST-99",
      confirmation_phrase: "delete it",
    });
    expect(mockDeleteIssue).not.toHaveBeenCalled();
  });

  it("deletes when confirmation_phrase is 'DELETE CONFIRMED'", async () => {
    mockDeleteIssue.mockResolvedValueOnce(undefined);

    const result = await handleIssueTool("jira_delete_issue", {
      issue_key: "TEST-99",
      confirmation_phrase: "DELETE CONFIRMED",
    });

    expect(mockDeleteIssue).toHaveBeenCalledWith("TEST-99");
    expect(result).toContain("TEST-99");
  });
});

describe("handleIssueTool — jira_link_issues", () => {
  it("links two issues by relationship type", async () => {
    mockLinkIssues.mockResolvedValueOnce(undefined);

    const result = await handleIssueTool("jira_link_issues", {
      from_key: "TEST-1",
      to_key: "TEST-2",
      link_type: "blocks",
    });

    expect(mockLinkIssues).toHaveBeenCalledWith("TEST-1", "TEST-2", "blocks");
    expect(result).toContain("TEST-1");
    expect(result).toContain("TEST-2");
    expect(result).toContain("blocks");
  });
});

describe("handleIssueTool — jira_assign_issue", () => {
  it("assigns issue to accountId", async () => {
    mockAssignIssue.mockResolvedValueOnce(undefined);

    const result = await handleIssueTool("jira_assign_issue", {
      issue_key: "TEST-3",
      account_id: "account-xyz",
    });

    expect(mockAssignIssue).toHaveBeenCalledWith("TEST-3", "account-xyz");
    expect(result).toContain("TEST-3");
    expect(result).toContain("account-xyz");
  });

  it("unassigns issue with null accountId", async () => {
    mockAssignIssue.mockResolvedValueOnce(undefined);

    const result = await handleIssueTool("jira_assign_issue", {
      issue_key: "TEST-3",
      account_id: null,
    });

    expect(mockAssignIssue).toHaveBeenCalledWith("TEST-3", null);
    expect(result).toContain("unassigned");
  });
});

describe("handleIssueTool — unknown tool", () => {
  it("throws for an unknown tool name", async () => {
    await expect(handleIssueTool("jira_nonexistent", {})).rejects.toThrow(
      "Unknown issue tool",
    );
  });
});
