/**
 * Unit tests for DraftManager.
 * Uses real fs with OS-temp paths to avoid interference with real .drafts.json.
 */
import { jest } from "@jest/globals";

import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";
import type { DraftArtifact } from "../../jira/types.js";

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
    draftStoragePath: join(tmpdir(), "dm-unit-singleton.json"),
    server: { name: "test", version: "1.0.0" },
  },
}));

jest.unstable_mockModule("../../utils/logger.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { DraftManager } = await import("../../ai/draft-manager.js");
type DraftManagerType = InstanceType<typeof DraftManager>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const tempPaths: string[] = [];
let counter = 0;

function freshManager(): DraftManagerType {
  const path = join(tmpdir(), `dm-test-${counter++}-${Date.now()}.json`);
  tempPaths.push(path);
  return new DraftManager(path);
}

afterAll(() => {
  for (const p of tempPaths) {
    if (existsSync(p)) unlinkSync(p);
  }
});

function makeArtifact(overrides: Partial<DraftArtifact> = {}): DraftArtifact {
  return {
    ref: "EPIC-01",
    type: "Epic",
    summary: "Authentication overhaul",
    description: "Revamp the auth system.",
    priority: "High",
    storyPoints: 8,
    acceptanceCriteria: ["Users can log in with SSO"],
    labels: ["auth"],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DraftManager — create", () => {
  it("creates a draft with pending_review status", () => {
    const mgr = freshManager();
    const draft = mgr.create("TEST", "Sprint planning", [makeArtifact()]);
    expect(draft.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(draft.status).toBe("pending_review");
    expect(draft.artifacts).toHaveLength(1);
    expect(draft.actionLog[0].action).toBe("draft_created");
  });

  it("persists to disk on create", () => {
    const path = join(tmpdir(), `dm-persist-${Date.now()}.json`);
    tempPaths.push(path);
    const mgr = new DraftManager(path);
    mgr.create("TEST", "ctx", [makeArtifact()]);
    expect(existsSync(path)).toBe(true);
  });
});

describe("DraftManager — get / list", () => {
  it("get returns the draft by id", () => {
    const mgr = freshManager();
    const draft = mgr.create("TEST", "ctx", [makeArtifact()]);
    expect(mgr.get(draft.id)).toEqual(draft);
  });

  it("get returns undefined for unknown id", () => {
    expect(freshManager().get("nonexistent-id")).toBeUndefined();
  });

  it("list returns all drafts sorted newest-first", () => {
    jest.useFakeTimers();
    const mgr = freshManager();
    jest.setSystemTime(new Date("2025-01-01T10:00:00Z"));
    const d1 = mgr.create("TEST", "First", [makeArtifact()]);
    jest.setSystemTime(new Date("2025-01-01T11:00:00Z"));
    const d2 = mgr.create("TEST", "Second", [
      makeArtifact({ ref: "STORY-01", type: "Story" }),
    ]);
    jest.useRealTimers();
    const list = mgr.list();
    expect(list[0].id).toBe(d2.id);
    expect(list[1].id).toBe(d1.id);
  });

  it("list returns empty array when no drafts", () => {
    expect(freshManager().list()).toEqual([]);
  });
});

describe("DraftManager — approve", () => {
  it("approve all → status approved", () => {
    const mgr = freshManager();
    const { id } = mgr.create("TEST", "ctx", [makeArtifact()]);
    expect(mgr.approve(id, "all").status).toBe("approved");
  });

  it("approve partial refs → status partial with items logged", () => {
    const mgr = freshManager();
    const { id } = mgr.create("TEST", "ctx", [
      makeArtifact(),
      makeArtifact({ ref: "STORY-01", type: "Story" }),
    ]);
    const result = mgr.approve(id, ["EPIC-01"]);
    expect(result.status).toBe("partial");
    expect(result.actionLog.at(-1)?.items).toEqual(["EPIC-01"]);
  });

  it("throws when trying to approve a committed draft", () => {
    const mgr = freshManager();
    const { id } = mgr.create("TEST", "ctx", [makeArtifact()]);
    mgr.approve(id, "all");
    mgr.markCommitted(id, [{ ref: "EPIC-01", key: "TEST-1" }]);
    expect(() => mgr.approve(id, "all")).toThrow(/Cannot approve/);
  });

  it("re-approving an already approved draft is a no-op", () => {
    const mgr = freshManager();
    const { id } = mgr.create("TEST", "ctx", [makeArtifact()]);
    mgr.approve(id, "all");

    expect(() => mgr.approve(id, "all")).not.toThrow();
    expect(mgr.get(id)?.status).toBe("approved");
  });
});

describe("DraftManager — reject", () => {
  it("sets status rejected with feedback", () => {
    const mgr = freshManager();
    const { id } = mgr.create("TEST", "ctx", [makeArtifact()]);
    const rejected = mgr.reject(id, "Story points are too low");
    expect(rejected.status).toBe("rejected");
    expect(rejected.feedback).toBe("Story points are too low");
  });

  it("throws when rejecting an approved draft", () => {
    const mgr = freshManager();
    const { id } = mgr.create("TEST", "ctx", [makeArtifact()]);
    mgr.approve(id, "all");
    expect(() => mgr.reject(id, "nope")).toThrow(/Cannot reject/);
  });
});

describe("DraftManager — revise", () => {
  it("resets to pending_review with new artifacts and clears feedback", () => {
    const mgr = freshManager();
    const { id } = mgr.create("TEST", "ctx", [makeArtifact()]);
    mgr.reject(id, "needs work");
    const revised = mgr.revise(id, [makeArtifact({ storyPoints: 13 })]);
    expect(revised.status).toBe("pending_review");
    expect(revised.artifacts[0].storyPoints).toBe(13);
    expect(revised.feedback).toBeUndefined();
  });
});

describe("DraftManager — markCommitted", () => {
  it("marks committed keys on artifacts and sets status", () => {
    const mgr = freshManager();
    const { id } = mgr.create("TEST", "ctx", [makeArtifact()]);
    mgr.approve(id, "all");
    const committed = mgr.markCommitted(id, [
      { ref: "EPIC-01", key: "TEST-42" },
    ]);
    expect(committed.status).toBe("committed");
    expect(committed.artifacts[0].committedKey).toBe("TEST-42");
  });
});

describe("DraftManager — delete", () => {
  it("removes draft from in-memory store", () => {
    const mgr = freshManager();
    const { id } = mgr.create("TEST", "ctx", [makeArtifact()]);
    mgr.delete(id);
    expect(mgr.get(id)).toBeUndefined();
    expect(mgr.list()).toHaveLength(0);
  });
});

describe("DraftManager — formatReviewSummary", () => {
  it("includes id, project, status, and refs", () => {
    const mgr = freshManager();
    const draft = mgr.create("TEST", "Sprint planning", [
      makeArtifact(),
      makeArtifact({ ref: "STORY-01", type: "Story", summary: "Login page" }),
    ]);
    const summary = mgr.formatReviewSummary(draft);
    expect(summary).toContain(draft.id);
    expect(summary).toContain("PENDING REVIEW");
    expect(summary).toContain("EPIC-01");
    expect(summary).toContain("STORY-01");
  });

  it("shows feedback when present", () => {
    const mgr = freshManager();
    const { id } = mgr.create("TEST", "ctx", [makeArtifact()]);
    mgr.reject(id, "Needs more detail");
    expect(mgr.formatReviewSummary(mgr.get(id)!)).toContain(
      "Needs more detail",
    );
  });

  it("shows REVIEW NEEDED flag for flagged artifacts", () => {
    const mgr = freshManager();
    const draft = mgr.create("TEST", "ctx", [
      makeArtifact({ flaggedForReview: true }),
    ]);
    expect(mgr.formatReviewSummary(draft)).toContain("\u2691");
  });

  it("totals story points correctly", () => {
    const mgr = freshManager();
    const draft = mgr.create("TEST", "ctx", [
      makeArtifact({ storyPoints: 5 }),
      makeArtifact({ ref: "STORY-01", type: "Story", storyPoints: 3 }),
    ]);
    expect(mgr.formatReviewSummary(draft)).toContain("8 story points");
  });
});

describe("DraftManager — state machine guards", () => {
  it("cannot approve a committed draft", () => {
    const mgr = freshManager();
    const { id } = mgr.create("TEST", "ctx", [makeArtifact()]);
    mgr.approve(id, "all");
    mgr.markCommitted(id, [{ ref: "EPIC-01", key: "TEST-1" }]);
    expect(() => mgr.approve(id, "all")).toThrow();
  });

  it("cannot reject a committed draft", () => {
    const mgr = freshManager();
    const { id } = mgr.create("TEST", "ctx", [makeArtifact()]);
    mgr.approve(id, "all");
    mgr.markCommitted(id, [{ ref: "EPIC-01", key: "TEST-1" }]);
    expect(() => mgr.reject(id, "too late")).toThrow();
  });

  it("throws for unknown draft id", () => {
    expect(() => freshManager().approve("bad-id", "all")).toThrow(
      "Draft not found: bad-id",
    );
  });
});

describe("DraftManager — disk round-trip", () => {
  it("loads persisted drafts from a file written by another instance", () => {
    const path = join(tmpdir(), `dm-roundtrip-${Date.now()}.json`);
    tempPaths.push(path);

    const mgr1 = new DraftManager(path);
    const created = mgr1.create("DISK", "from disk test", [makeArtifact()]);

    const mgr2 = new DraftManager(path);
    const loaded = mgr2.get(created.id);

    expect(loaded?.projectKey).toBe("DISK");
    expect(loaded?.status).toBe("pending_review");
  });
});
