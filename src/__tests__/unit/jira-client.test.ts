/**
 * Unit tests for JiraClient.
 * Mocks axios.create so no real HTTP calls are made.
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

// Build a spy-able axios mock. The factory has no outer-variable references.
let axiosInstance: Record<string, jest.Mock>;

jest.unstable_mockModule("axios", () => {
  axiosInstance = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    interceptors: { response: { use: jest.fn() } } as unknown as jest.Mock,
  };
  return { default: { create: jest.fn(() => axiosInstance) } };
});

const { JiraClient } = await import("../../jira/client.js");

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  for (const key of Object.keys(axiosInstance)) {
    if (typeof axiosInstance[key]?.mockClear === "function") {
      (axiosInstance[key] as jest.Mock).mockClear();
    }
  }
});

describe("JiraClient — createIssue", () => {
  it("POSTs to /rest/api/2/issue and returns issue data", async () => {
    const client = new JiraClient();
    const issue = { id: "1", key: "TEST-1", self: "http://localhost", fields: { summary: "S" } };
    (axiosInstance["post"] as jest.Mock).mockResolvedValueOnce({ data: issue });

    const fields = { summary: "Test", issuetype: { name: "Story" }, project: { key: "TEST" } };
    const result = await client.createIssue(fields as never);

    expect(axiosInstance["post"]).toHaveBeenCalledWith("/rest/api/2/issue", { fields });
    expect(result.key).toBe("TEST-1");
  });
});

describe("JiraClient — getIssue", () => {
  it("GETs /rest/api/2/issue/:key", async () => {
    const client = new JiraClient();
    const issue = { id: "1", key: "TEST-42", self: "http://localhost", fields: { summary: "Auth" } };
    (axiosInstance["get"] as jest.Mock).mockResolvedValueOnce({ data: issue });

    const result = await client.getIssue("TEST-42");
    expect(axiosInstance["get"]).toHaveBeenCalledWith("/rest/api/2/issue/TEST-42");
    expect(result.key).toBe("TEST-42");
  });
});

describe("JiraClient — updateIssue", () => {
  it("PUTs to /rest/api/2/issue/:key with fields", async () => {
    const client = new JiraClient();
    (axiosInstance["put"] as jest.Mock).mockResolvedValueOnce({ data: {} });

    await client.updateIssue("TEST-5", { summary: "Updated" } as never);
    expect(axiosInstance["put"]).toHaveBeenCalledWith(
      "/rest/api/2/issue/TEST-5",
      { fields: { summary: "Updated" } },
    );
  });
});

describe("JiraClient — deleteIssue", () => {
  it("DELETEs /rest/api/2/issue/:key", async () => {
    const client = new JiraClient();
    (axiosInstance["delete"] as jest.Mock).mockResolvedValueOnce({ data: {} });

    await client.deleteIssue("TEST-99");
    expect(axiosInstance["delete"]).toHaveBeenCalledWith("/rest/api/2/issue/TEST-99");
  });
});

describe("JiraClient — assignIssue", () => {
  it("PUTs accountId to assignee endpoint", async () => {
    const client = new JiraClient();
    (axiosInstance["put"] as jest.Mock).mockResolvedValueOnce({ data: {} });

    await client.assignIssue("TEST-1", "account-abc");
    expect(axiosInstance["put"]).toHaveBeenCalledWith(
      "/rest/api/2/issue/TEST-1/assignee",
      { accountId: "account-abc" },
    );
  });

  it("sends null to unassign", async () => {
    const client = new JiraClient();
    (axiosInstance["put"] as jest.Mock).mockResolvedValueOnce({ data: {} });

    await client.assignIssue("TEST-1", null);
    expect(axiosInstance["put"]).toHaveBeenCalledWith(
      "/rest/api/2/issue/TEST-1/assignee",
      { accountId: null },
    );
  });
});

describe("JiraClient — linkIssues", () => {
  it("POSTs to /rest/api/2/issueLink", async () => {
    const client = new JiraClient();
    (axiosInstance["post"] as jest.Mock).mockResolvedValueOnce({ data: {} });

    await client.linkIssues("TEST-1", "TEST-2", "blocks");
    expect(axiosInstance["post"]).toHaveBeenCalledWith("/rest/api/2/issueLink", {
      type: { name: "blocks" },
      inwardIssue: { key: "TEST-1" },
      outwardIssue: { key: "TEST-2" },
    });
  });
});

describe("JiraClient — searchIssues", () => {
  it("POSTs JQL to /rest/api/2/search with pagination", async () => {
    const client = new JiraClient();
    (axiosInstance["post"] as jest.Mock).mockResolvedValueOnce({
      data: { issues: [], total: 0, maxResults: 10, startAt: 0 },
    });

    const result = await client.searchIssues("project = TEST", 10, 5);
    expect(axiosInstance["post"]).toHaveBeenCalledWith(
      "/rest/api/2/search",
      expect.objectContaining({ jql: "project = TEST", maxResults: 10, startAt: 5 }),
    );
    expect(result.total).toBe(0);
  });
});

describe("JiraClient — addComment", () => {
  it("POSTs body to comment endpoint", async () => {
    const client = new JiraClient();
    (axiosInstance["post"] as jest.Mock).mockResolvedValueOnce({ data: {} });

    await client.addComment("TEST-3", "Great work!");
    expect(axiosInstance["post"]).toHaveBeenCalledWith(
      "/rest/api/2/issue/TEST-3/comment",
      { body: "Great work!" },
    );
  });
});

describe("JiraClient — getTransitions", () => {
  it("returns transitions array", async () => {
    const client = new JiraClient();
    const transitions = [
      { id: "11", name: "To Do", to: { id: "1", name: "To Do", statusCategory: { key: "new", name: "To Do" } }, isGlobal: true },
    ];
    (axiosInstance["get"] as jest.Mock).mockResolvedValueOnce({ data: { transitions } });

    const result = await client.getTransitions("TEST-1");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("To Do");
  });
});

describe("JiraClient — transitionIssue", () => {
  it("POSTs transition id", async () => {
    const client = new JiraClient();
    (axiosInstance["post"] as jest.Mock).mockResolvedValueOnce({ data: {} });

    await client.transitionIssue("TEST-1", "21");
    expect(axiosInstance["post"]).toHaveBeenCalledWith(
      "/rest/api/2/issue/TEST-1/transitions",
      { transition: { id: "21" } },
    );
  });

  it("includes comment update when comment provided", async () => {
    const client = new JiraClient();
    (axiosInstance["post"] as jest.Mock).mockResolvedValueOnce({ data: {} });

    await client.transitionIssue("TEST-1", "31", "Moving to Done");
    expect(axiosInstance["post"]).toHaveBeenCalledWith(
      "/rest/api/2/issue/TEST-1/transitions",
      {
        transition: { id: "31" },
        update: { comment: [{ add: { body: "Moving to Done" } }] },
      },
    );
  });
});

describe("JiraClient — createSprint", () => {
  it("POSTs to /rest/agile/1.0/sprint", async () => {
    const client = new JiraClient();
    (axiosInstance["post"] as jest.Mock).mockResolvedValueOnce({
      data: { id: 5, name: "Sprint 5", state: "future" },
    });

    const result = await client.createSprint(1, "Sprint 5", "Ship auth", "2026-03-15T09:00:00Z");
    expect(axiosInstance["post"]).toHaveBeenCalledWith("/rest/agile/1.0/sprint", expect.objectContaining({
      name: "Sprint 5",
      goal: "Ship auth",
      originBoardId: 1,
    }));
    expect(result.id).toBe(5);
  });
});

describe("JiraClient — moveIssuesToSprint", () => {
  it("POSTs issue keys to sprint endpoint", async () => {
    const client = new JiraClient();
    (axiosInstance["post"] as jest.Mock).mockResolvedValueOnce({ data: {} });

    await client.moveIssuesToSprint(5, ["TEST-1", "TEST-2"]);
    expect(axiosInstance["post"]).toHaveBeenCalledWith(
      "/rest/agile/1.0/sprint/5/issue",
      { issues: ["TEST-1", "TEST-2"] },
    );
  });
});

describe("JiraClient — getProject", () => {
  it("GETs project with expanded fields", async () => {
    const client = new JiraClient();
    const project = { id: "1", key: "TEST", name: "Test", issueTypes: [], components: [] };
    (axiosInstance["get"] as jest.Mock).mockResolvedValueOnce({ data: project });

    const result = await client.getProject("TEST");
    expect(axiosInstance["get"]).toHaveBeenCalledWith(
      "/rest/api/2/project/TEST?expand=issueTypes,components",
    );
    expect(result.key).toBe("TEST");
  });
});

describe("JiraClient — listAssignableUsers", () => {
  it("GETs assignable users for project", async () => {
    const client = new JiraClient();
    const users = [
      { accountId: "acc-1", displayName: "Alice", emailAddress: "alice@example.com", active: true },
    ];
    (axiosInstance["get"] as jest.Mock).mockResolvedValueOnce({ data: users });

    const result = await client.listAssignableUsers("TEST");
    expect(result[0].displayName).toBe("Alice");
  });
});
