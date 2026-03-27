/**
 * Unit tests for workflow-tools handleWorkflowTool.
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

const mockGetTransitions: jest.Mock = jest.fn();
const mockTransitionIssue: jest.Mock = jest.fn();

jest.unstable_mockModule("../../jira/client.js", () => ({
  jiraClient: {
    getTransitions: mockGetTransitions,
    transitionIssue: mockTransitionIssue,
  },
}));

const { handleWorkflowTool } = await import("../../tools/workflow-tools.js");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const sampleTransitions = [
  {
    id: "11",
    name: "To Do",
    to: { id: "1", name: "To Do", statusCategory: { key: "new", name: "New", colorName: "blue-gray" } },
    isGlobal: true,
  },
  {
    id: "21",
    name: "In Progress",
    to: { id: "3", name: "In Progress", statusCategory: { key: "indeterminate", name: "In Progress", colorName: "yellow" } },
    isGlobal: true,
  },
  {
    id: "31",
    name: "Done",
    to: { id: "10001", name: "Done", statusCategory: { key: "done", name: "Done", colorName: "green" } },
    isGlobal: false,
  },
];

beforeEach(() => jest.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleWorkflowTool — jira_get_transitions", () => {
  it("returns JSON array of available transitions", async () => {
    mockGetTransitions.mockResolvedValueOnce(sampleTransitions);

    const result = await handleWorkflowTool("jira_get_transitions", { issue_key: "TEST-1" });

    expect(mockGetTransitions).toHaveBeenCalledWith("TEST-1");
    const parsed = JSON.parse(result as string) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(3);
    expect(parsed[0]["name"]).toBe("To Do");
    expect(parsed[0]["id"]).toBe("11");
    expect(parsed[0]).toHaveProperty("toStatus");
  });

  it("returns empty JSON array when no transitions exist", async () => {
    mockGetTransitions.mockResolvedValueOnce([]);

    const result = await handleWorkflowTool("jira_get_transitions", { issue_key: "TEST-99" });
    const parsed = JSON.parse(result as string) as unknown[];
    expect(parsed).toHaveLength(0);
  });
});

describe("handleWorkflowTool — jira_transition_issue", () => {
  it("transitions issue using the provided transition_id", async () => {
    mockTransitionIssue.mockResolvedValueOnce(undefined);

    const result = await handleWorkflowTool("jira_transition_issue", {
      issue_key: "TEST-1",
      transition_id: "21",
    });

    expect(mockTransitionIssue).toHaveBeenCalledWith("TEST-1", "21", undefined);
    expect(result).toContain("TEST-1");
    expect(result).toContain("21");
  });

  it("passes comment when provided", async () => {
    mockTransitionIssue.mockResolvedValueOnce(undefined);

    const result = await handleWorkflowTool("jira_transition_issue", {
      issue_key: "TEST-1",
      transition_id: "31",
      comment: "All tests passed",
    });

    expect(mockTransitionIssue).toHaveBeenCalledWith("TEST-1", "31", "All tests passed");
    expect(result).toContain("comment added");
  });

  it("omits comment suffix when no comment provided", async () => {
    mockTransitionIssue.mockResolvedValueOnce(undefined);

    const result = await handleWorkflowTool("jira_transition_issue", {
      issue_key: "TEST-2",
      transition_id: "11",
    });

    expect(result).not.toContain("comment added");
  });
});

describe("handleWorkflowTool — unknown tool", () => {
  it("throws for unknown tool name", async () => {
    await expect(handleWorkflowTool("jira_unknown", {})).rejects.toThrow(
      "Unknown workflow tool",
    );
  });
});
