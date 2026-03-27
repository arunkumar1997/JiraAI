/**
 * Unit tests for search-tools handleSearchTool.
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

const mockSearchIssues: jest.Mock = jest.fn();
const mockGetProject: jest.Mock = jest.fn();
const mockListAssignableUsers: jest.Mock = jest.fn();

jest.unstable_mockModule("../../jira/client.js", () => ({
  jiraClient: {
    searchIssues: mockSearchIssues,
    getProject: mockGetProject,
    listAssignableUsers: mockListAssignableUsers,
  },
}));

const { handleSearchTool } = await import("../../tools/search-tools.js");

beforeEach(() => jest.clearAllMocks());

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSearchResult(keys: string[]) {
  return {
    issues: keys.map((k) => ({
      id: "1",
      key: k,
      self: `http://localhost/${k}`,
      fields: {
        summary: `Issue ${k}`,
        issuetype: { id: "1", name: "Story", subtask: false },
        status: { name: "In Progress", statusCategory: { id: 3, key: "indeterminate", name: "In Progress" } },
        priority: { name: "High" as const },
        assignee: { accountId: "acc-1", displayName: "Alice", emailAddress: "alice@x.com" },
        reporter: undefined,
        labels: [],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    })),
    total: keys.length,
    maxResults: 50,
    startAt: 0,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleSearchTool — jira_search_issues", () => {
  it("executes JQL and returns JSON with matching issues", async () => {
    mockSearchIssues.mockResolvedValueOnce(makeSearchResult(["TEST-1"]));

    const result = await handleSearchTool("jira_search_issues", {
      jql: "project = TEST AND status = 'In Progress'",
      max_results: 50,
    });

    expect(mockSearchIssues).toHaveBeenCalledWith(
      "project = TEST AND status = 'In Progress'",
      50,
      0,
    );
    const parsed = JSON.parse(result as string);
    expect(parsed.total).toBe(1);
    expect(parsed.issues[0].key).toBe("TEST-1");
  });

  it("applies pagination startAt", async () => {
    mockSearchIssues.mockResolvedValueOnce(makeSearchResult([]));

    await handleSearchTool("jira_search_issues", {
      jql: "project = TEST",
      max_results: 10,
      start_at: 20,
    });

    expect(mockSearchIssues).toHaveBeenCalledWith("project = TEST", 10, 20);
  });

  it("defaults max_results to 50 and start_at to 0", async () => {
    mockSearchIssues.mockResolvedValueOnce(makeSearchResult([]));

    await handleSearchTool("jira_search_issues", { jql: "project = TEST" });

    expect(mockSearchIssues).toHaveBeenCalledWith("project = TEST", 50, 0);
  });

  it("returns correct shape in JSON response", async () => {
    mockSearchIssues.mockResolvedValueOnce(makeSearchResult(["TEST-5"]));

    const result = await handleSearchTool("jira_search_issues", { jql: "key = TEST-5" });
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveProperty("total");
    expect(parsed).toHaveProperty("returned");
    expect(parsed.issues[0]).toHaveProperty("key");
    expect(parsed.issues[0]).toHaveProperty("status");
    expect(parsed.issues[0]).toHaveProperty("assignee");
  });
});

describe("handleSearchTool — jira_get_project", () => {
  it("returns project JSON", async () => {
    mockGetProject.mockResolvedValueOnce({
      id: "10001",
      key: "TEST",
      name: "Test Project",
      issueTypes: [{ id: "1", name: "Story", subtask: false }],
      components: [],
    });

    const result = await handleSearchTool("jira_get_project", { project_key: "TEST" });

    expect(mockGetProject).toHaveBeenCalledWith("TEST");
    const parsed = JSON.parse(result as string);
    expect(parsed.key).toBe("TEST");
    expect(parsed.name).toBe("Test Project");
  });

  it("falls back to configured projectKey when project_key is omitted", async () => {
    mockGetProject.mockResolvedValueOnce({ id: "1", key: "TEST", name: "P", issueTypes: [], components: [] });

    await handleSearchTool("jira_get_project", {});
    expect(mockGetProject).toHaveBeenCalledWith("TEST");
  });
});

describe("handleSearchTool — jira_list_users", () => {
  it("returns JSON array of assignable users", async () => {
    mockListAssignableUsers.mockResolvedValueOnce([
      { accountId: "acc-1", displayName: "Alice", emailAddress: "alice@example.com", active: true },
      { accountId: "acc-2", displayName: "Bob", emailAddress: "bob@example.com", active: true },
    ]);

    const result = await handleSearchTool("jira_list_users", { project_key: "TEST" });

    expect(mockListAssignableUsers).toHaveBeenCalledWith("TEST");
    const parsed = JSON.parse(result as string) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]["name"]).toBe("Alice");
  });

  it("returns empty array when no users found", async () => {
    mockListAssignableUsers.mockResolvedValueOnce([]);

    const result = await handleSearchTool("jira_list_users", { project_key: "EMPTY" });
    const parsed = JSON.parse(result as string) as unknown[];
    expect(parsed).toHaveLength(0);
  });
});

describe("handleSearchTool — unknown tool", () => {
  it("throws for unrecognised tool", async () => {
    await expect(handleSearchTool("jira_bogus", {})).rejects.toThrow();
  });
});
