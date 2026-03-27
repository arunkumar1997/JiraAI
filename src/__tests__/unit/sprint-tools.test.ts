/**
 * Unit tests for sprint-tools handleSprintTool.
 */
import { jest } from "@jest/globals";

jest.unstable_mockModule("../../config.js", () => ({
  Config: {
    jira: {
      baseUrl: "http://localhost:8080",
      pat: "test-pat",
      projectKey: "TEST",
      boardId: 42,
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

const mockCreateSprint: jest.Mock = jest.fn();
const mockUpdateSprint: jest.Mock = jest.fn();
const mockMoveIssuesToSprint: jest.Mock = jest.fn();
const mockGetBoard: jest.Mock = jest.fn();
const mockGetBoardSprints: jest.Mock = jest.fn();

jest.unstable_mockModule("../../jira/client.js", () => ({
  jiraClient: {
    createSprint: mockCreateSprint,
    updateSprint: mockUpdateSprint,
    moveIssuesToSprint: mockMoveIssuesToSprint,
    getBoard: mockGetBoard,
    getBoardSprints: mockGetBoardSprints,
  },
}));

const { handleSprintTool } = await import("../../tools/sprint-tools.js");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fakeSprint = {
  id: 10,
  name: "Sprint 1",
  state: "active" as const,
  startDate: "2026-01-01T09:00:00Z",
  endDate: "2026-01-14T17:00:00Z",
  goal: "Ship MVP",
};

const fakeBoard = {
  id: 42,
  name: "TEST Board",
  type: "scrum" as const,
  self: "http://localhost/agile/1.0/board/42",
};

beforeEach(() => jest.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleSprintTool — jira_create_sprint", () => {
  it("creates a sprint in the configured board", async () => {
    mockCreateSprint.mockResolvedValueOnce(fakeSprint);

    const result = await handleSprintTool("jira_create_sprint", {
      name: "Sprint 1",
      goal: "Ship MVP",
      start_date: "2026-01-01T09:00:00Z",
      end_date: "2026-01-14T17:00:00Z",
    });

    expect(mockCreateSprint).toHaveBeenCalledWith(
      42,
      "Sprint 1",
      "Ship MVP",
      "2026-01-01T09:00:00Z",
      "2026-01-14T17:00:00Z",
    );
    expect(result).toContain("Sprint 1");
    expect(result).toContain("10");
  });

  it("uses a custom board_id when provided", async () => {
    mockCreateSprint.mockResolvedValueOnce({ ...fakeSprint, id: 11 });

    await handleSprintTool("jira_create_sprint", {
      name: "Custom Board Sprint",
      goal: "Custom goal",
      board_id: 99,
    });

    expect(mockCreateSprint).toHaveBeenCalledWith(
      99,
      "Custom Board Sprint",
      "Custom goal",
      undefined,
      undefined,
    );
  });
});

describe("handleSprintTool — jira_update_sprint", () => {
  it("updates sprint fields and returns confirmation", async () => {
    mockUpdateSprint.mockResolvedValueOnce({ ...fakeSprint, name: "Sprint 1 – Revised" });

    const result = await handleSprintTool("jira_update_sprint", {
      sprint_id: 10,
      name: "Sprint 1 – Revised",
      state: "closed",
    });

    expect(mockUpdateSprint).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ name: "Sprint 1 – Revised", state: "closed" }),
    );
    expect(result).toContain("Sprint");
    expect(result).toContain("10");
  });
});

describe("handleSprintTool — jira_move_to_sprint", () => {
  it("moves issues to the given sprint", async () => {
    mockMoveIssuesToSprint.mockResolvedValueOnce(undefined);

    const result = await handleSprintTool("jira_move_to_sprint", {
      sprint_id: 10,
      issue_keys: ["TEST-1", "TEST-2", "TEST-3"],
    });

    expect(mockMoveIssuesToSprint).toHaveBeenCalledWith(10, ["TEST-1", "TEST-2", "TEST-3"]);
    expect(result).toContain("3");
    expect(result).toContain("10");
  });
});

describe("handleSprintTool — jira_get_board", () => {
  it("returns JSON with board details and sprints", async () => {
    mockGetBoard.mockResolvedValueOnce(fakeBoard);
    mockGetBoardSprints.mockResolvedValueOnce([fakeSprint]);

    const result = await handleSprintTool("jira_get_board", {});

    expect(mockGetBoard).toHaveBeenCalledWith(42);
    expect(mockGetBoardSprints).toHaveBeenCalledWith(42);
    const parsed = JSON.parse(result as string);
    expect(parsed.board.id).toBe(42);
    expect(parsed.sprints).toHaveLength(1);
    expect(parsed.sprints[0].name).toBe("Sprint 1");
  });

  it("accepts explicit board_id override", async () => {
    mockGetBoard.mockResolvedValueOnce({ ...fakeBoard, id: 7 });
    mockGetBoardSprints.mockResolvedValueOnce([]);

    await handleSprintTool("jira_get_board", { board_id: 7 });

    expect(mockGetBoard).toHaveBeenCalledWith(7);
    expect(mockGetBoardSprints).toHaveBeenCalledWith(7);
  });
});

describe("handleSprintTool — unknown tool", () => {
  it("throws for unrecognised tool name", async () => {
    await expect(handleSprintTool("jira_sprint_foo", {})).rejects.toThrow(
      "Unknown sprint tool",
    );
  });
});
