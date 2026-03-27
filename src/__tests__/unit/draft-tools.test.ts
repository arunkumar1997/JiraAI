/**
 * Unit tests for draft-tools handleDraftTool.
 * The draftManager singleton and jiraClient are fully mocked.
 */
import { jest } from "@jest/globals";
import type { Draft, DraftArtifact } from "../../jira/types.js";

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

// ── draftManager mock ─────────────────────────────────────────────────────────
const mockCreate: jest.Mock = jest.fn();
const mockGet: jest.Mock = jest.fn();
const mockList: jest.Mock = jest.fn();
const mockApprove: jest.Mock = jest.fn();
const mockReject: jest.Mock = jest.fn();
const mockRevise: jest.Mock = jest.fn();
const mockMarkCommitted: jest.Mock = jest.fn();
const mockFormatReviewSummary: jest.Mock = jest.fn();

jest.unstable_mockModule("../../ai/draft-manager.js", () => ({
  draftManager: {
    create: mockCreate,
    get: mockGet,
    list: mockList,
    approve: mockApprove,
    reject: mockReject,
    revise: mockRevise,
    markCommitted: mockMarkCommitted,
    formatReviewSummary: mockFormatReviewSummary,
  },
  DraftManager: class {},
}));

// ── jiraClient mock ───────────────────────────────────────────────────────────
const mockCreateIssue: jest.Mock = jest.fn();
const mockUpdateIssue: jest.Mock = jest.fn();
const mockLinkIssues: jest.Mock = jest.fn();

jest.unstable_mockModule("../../jira/client.js", () => ({
  jiraClient: {
    createIssue: mockCreateIssue,
    updateIssue: mockUpdateIssue,
    linkIssues: mockLinkIssues,
  },
}));

const { handleDraftTool } = await import("../../tools/draft-tools.js");

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeArtifact(overrides: Partial<DraftArtifact> = {}): DraftArtifact {
  return {
    ref: "STORY-01",
    type: "Story",
    summary: "User can log in",
    description: "As a user...",
    priority: "Medium",
    storyPoints: 3,
    acceptanceCriteria: ["AC1"],
    labels: [],
    components: [],
    flaggedForReview: false,
    notes: "",
    ...overrides,
  };
}

function makeDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: "draft-001",
    projectKey: "TEST",
    meetingContext: "Sprint planning meeting",
    artifacts: [makeArtifact()],
    status: "pending_review",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    actionLog: [],
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("handleDraftTool — create_jira_draft", () => {
  it("creates a draft and returns formatted summary", async () => {
    const draft = makeDraft();
    mockCreate.mockReturnValueOnce(draft);
    mockFormatReviewSummary.mockReturnValueOnce("## Draft draft-001\n...");

    const result = await handleDraftTool("create_jira_draft", {
      project_key: "TEST",
      meeting_context: "Sprint planning meeting",
      artifacts: [makeArtifact()],
    });

    expect(mockCreate).toHaveBeenCalledWith(
      "TEST",
      "Sprint planning meeting",
      expect.arrayContaining([expect.objectContaining({ ref: "STORY-01" })]),
    );
    expect(mockFormatReviewSummary).toHaveBeenCalledWith(draft);
    expect(result).toContain("Draft draft-001");
  });

  it("falls back to configured project key when project_key omitted", async () => {
    mockCreate.mockReturnValueOnce(makeDraft());
    mockFormatReviewSummary.mockReturnValueOnce("summary");

    await handleDraftTool("create_jira_draft", {
      meeting_context: "Retro",
      artifacts: [],
    });

    expect(mockCreate).toHaveBeenCalledWith("TEST", "Retro", []);
  });
});

describe("handleDraftTool — get_jira_draft", () => {
  it("returns formatted summary for existing draft", async () => {
    const draft = makeDraft();
    mockGet.mockReturnValueOnce(draft);
    mockFormatReviewSummary.mockReturnValueOnce("## Draft draft-001");

    const result = await handleDraftTool("get_jira_draft", { draft_id: "draft-001" });

    expect(mockGet).toHaveBeenCalledWith("draft-001");
    expect(result).toContain("Draft draft-001");
  });

  it("returns not-found message for missing draft", async () => {
    mockGet.mockReturnValueOnce(undefined);

    const result = await handleDraftTool("get_jira_draft", { draft_id: "ghost-id" });
    expect(result).toContain("ghost-id");
  });
});

describe("handleDraftTool — list_jira_drafts", () => {
  it("returns a line per draft", async () => {
    const draft = makeDraft();
    mockList.mockReturnValueOnce([draft]);

    const result = await handleDraftTool("list_jira_drafts", {});
    expect(mockList).toHaveBeenCalledTimes(1);
    // id is sliced to 8 chars + "…"
    expect(result).toContain("draft-00");
  });

  it("returns no-drafts message when list is empty", async () => {
    mockList.mockReturnValueOnce([]);

    const result = await handleDraftTool("list_jira_drafts", {});
    expect(result).toMatch(/no drafts/i);
  });
});

describe("handleDraftTool — approve_jira_draft", () => {
  it("approves all artifacts and prompts commit", async () => {
    const draft = makeDraft({ status: "approved", artifacts: [makeArtifact()] });
    mockApprove.mockReturnValueOnce(draft);

    const result = await handleDraftTool("approve_jira_draft", {
      draft_id: "draft-001",
      approve: "all",
    });

    expect(mockApprove).toHaveBeenCalledWith("draft-001", "all");
    expect(result).toContain("approved");
    expect(result).toContain("commit_jira_draft");
  });

  it("approves a subset of refs", async () => {
    const draft = makeDraft({ status: "partial" });
    mockApprove.mockReturnValueOnce(draft);

    await handleDraftTool("approve_jira_draft", {
      draft_id: "draft-001",
      approve: ["STORY-01"],
    });

    expect(mockApprove).toHaveBeenCalledWith("draft-001", ["STORY-01"]);
  });
});

describe("handleDraftTool — reject_jira_draft", () => {
  it("rejects draft with feedback", async () => {
    mockReject.mockReturnValueOnce(makeDraft({ status: "rejected" }));

    const result = await handleDraftTool("reject_jira_draft", {
      draft_id: "draft-001",
      feedback: "Story points are too large",
    });

    expect(mockReject).toHaveBeenCalledWith("draft-001", "Story points are too large");
    expect(result).toContain("rejected");
    expect(result).toContain("Story points are too large");
  });
});

describe("handleDraftTool — revise_jira_draft", () => {
  it("passes revised artifacts to draftManager.revise", async () => {
    const revised = [makeArtifact({ storyPoints: 5 })];
    const draft = makeDraft({ artifacts: revised });
    mockRevise.mockReturnValueOnce(draft);
    mockFormatReviewSummary.mockReturnValueOnce("## Revised draft");

    const result = await handleDraftTool("revise_jira_draft", {
      draft_id: "draft-001",
      artifacts: revised,
    });

    expect(mockRevise).toHaveBeenCalledWith("draft-001", revised);
    expect(result).toContain("Revised draft");
  });
});

describe("handleDraftTool — commit_jira_draft (dry_run)", () => {
  it("returns a dry-run preview without hitting jiraClient", async () => {
    const draft = makeDraft({ status: "approved" });
    mockGet.mockReturnValueOnce(draft);

    const result = await handleDraftTool("commit_jira_draft", {
      draft_id: "draft-001",
      refs: "all",
      dry_run: true,
    });

    expect(mockCreateIssue).not.toHaveBeenCalled();
    expect(result).toMatch(/dry run/i);
    expect(result).toContain("STORY-01");
  });
});

describe("handleDraftTool — commit_jira_draft (live)", () => {
  it("creates issues in JIRA for each artifact and returns summary", async () => {
    const artifact = makeArtifact({ ref: "EPIC-01", type: "Epic" });
    const draft = makeDraft({ status: "approved", artifacts: [artifact] });
    mockGet.mockReturnValueOnce(draft);
    mockCreateIssue.mockResolvedValueOnce({
      id: "100",
      key: "TEST-1",
      self: "http://localhost/TEST-1",
      fields: { summary: "User can log in" } as never,
    });
    mockUpdateIssue.mockResolvedValueOnce(undefined);
    mockMarkCommitted.mockReturnValueOnce(undefined);

    const result = await handleDraftTool("commit_jira_draft", {
      draft_id: "draft-001",
      refs: "all",
      dry_run: false,
    });

    expect(mockCreateIssue).toHaveBeenCalledTimes(1);
    expect(mockMarkCommitted).toHaveBeenCalledWith(
      "draft-001",
      [{ ref: "EPIC-01", key: "TEST-1" }],
    );
    expect(result).toContain("TEST-1");
  });

  it("returns error when draft not found", async () => {
    mockGet.mockReturnValueOnce(undefined);

    const result = await handleDraftTool("commit_jira_draft", {
      draft_id: "missing",
      refs: "all",
    });

    expect(result).toContain("missing");
  });

  it("refuses commit when draft is not approved", async () => {
    mockGet.mockReturnValueOnce(makeDraft({ status: "pending_review" }));

    const result = await handleDraftTool("commit_jira_draft", {
      draft_id: "draft-001",
      refs: "all",
    });

    expect(result).toMatch(/cannot commit/i);
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it("continues committing when one artifact fails", async () => {
    const story = makeArtifact({ ref: "STORY-01", type: "Story" });
    const bug = makeArtifact({ ref: "BUG-01", type: "Bug" });
    const draft = makeDraft({ status: "approved", artifacts: [story, bug] });
    mockGet.mockReturnValueOnce(draft);
    mockCreateIssue
      .mockResolvedValueOnce({ id: "1", key: "TEST-1", self: "", fields: {} as never })
      .mockRejectedValueOnce(new Error("Validation error"));
    mockUpdateIssue.mockResolvedValue(undefined);
    mockMarkCommitted.mockReturnValueOnce(undefined);

    const result = await handleDraftTool("commit_jira_draft", {
      draft_id: "draft-001",
      refs: "all",
    });

    expect(result).toContain("TEST-1");
    expect(result).toMatch(/FAILED/);
  });
});

describe("handleDraftTool — unknown tool", () => {
  it("throws for an unknown tool name", async () => {
    await expect(
      handleDraftTool("jira_unknown_draft_tool", {}),
    ).rejects.toThrow("Unknown draft tool");
  });
});
