import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { Config } from "../config";
import { logger } from "../utils/logger";
import type { Draft, DraftArtifact, DraftStatus } from "../jira/types";

// ─── Draft State Machine ───────────────────────────────────────────────────────
//
// Lifecycle:
//   pending_review → approved / partial / rejected
//   rejected       → pending_review  (after revision)
//   approved       → committed
//   partial        → committed
//
// Nothing reaches JIRA without passing through 'approved' or 'partial'.
// ─────────────────────────────────────────────────────────────────────────────

class DraftManager {
  private drafts: Map<string, Draft> = new Map();
  private readonly storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    // Ensure parent directory exists (e.g. ~/.jira-ai-mcp/)
    try {
      mkdirSync(dirname(storagePath), { recursive: true });
    } catch {
      // already exists
    }
    this.loadFromDisk();
  }

  // ─── Persistence ────────────────────────────────────────────────────────────

  private loadFromDisk(): void {
    if (!existsSync(this.storagePath)) return;
    try {
      const raw = readFileSync(this.storagePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, Draft>;
      for (const [id, draft] of Object.entries(data)) {
        this.drafts.set(id, draft);
      }
      logger.info(
        `Draft manager: loaded ${this.drafts.size} draft(s) from disk`,
      );
    } catch (err) {
      logger.warn("Draft manager: could not load persisted drafts", { err });
    }
  }

  private persist(): void {
    try {
      const data: Record<string, Draft> = {};
      for (const [id, draft] of this.drafts) data[id] = draft;
      writeFileSync(this.storagePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      logger.warn("Draft manager: could not persist drafts", { err });
    }
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  create(
    projectKey: string,
    meetingContext: string,
    artifacts: DraftArtifact[],
  ): Draft {
    const id = randomUUID();
    const now = new Date().toISOString();
    const draft: Draft = {
      id,
      createdAt: now,
      updatedAt: now,
      projectKey,
      meetingContext,
      status: "pending_review",
      artifacts,
      actionLog: [
        {
          timestamp: now,
          action: "draft_created",
          note: `${artifacts.length} artifact(s) generated from meeting context`,
        },
      ],
    };
    this.drafts.set(id, draft);
    this.persist();
    logger.info("Draft created", { draftId: id, artifacts: artifacts.length });
    return draft;
  }

  get(id: string): Draft | undefined {
    return this.drafts.get(id);
  }

  list(): Draft[] {
    return [...this.drafts.values()].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  // ─── State Transitions ──────────────────────────────────────────────────────

  approve(id: string, refs: string[] | "all"): Draft {
    const draft = this.getOrThrow(id);
    this.assertStatus(draft, ["pending_review", "rejected"], "approve");
    const now = new Date().toISOString();

    if (refs === "all") {
      draft.status = "approved";
      draft.actionLog.push({ timestamp: now, action: "approved_all" });
    } else {
      draft.status = "partial";
      draft.actionLog.push({
        timestamp: now,
        action: "approved_partial",
        items: refs,
      });
    }
    draft.updatedAt = now;
    this.persist();
    return draft;
  }

  reject(id: string, feedback: string): Draft {
    const draft = this.getOrThrow(id);
    this.assertStatus(draft, ["pending_review"], "reject");
    const now = new Date().toISOString();
    draft.status = "rejected";
    draft.feedback = feedback;
    draft.updatedAt = now;
    draft.actionLog.push({
      timestamp: now,
      action: "rejected",
      note: feedback,
    });
    this.persist();
    return draft;
  }

  revise(id: string, artifacts: DraftArtifact[]): Draft {
    const draft = this.getOrThrow(id);
    this.assertStatus(draft, ["rejected", "pending_review"], "revise");
    const now = new Date().toISOString();
    draft.artifacts = artifacts;
    draft.status = "pending_review";
    draft.updatedAt = now;
    draft.feedback = undefined;
    draft.actionLog.push({
      timestamp: now,
      action: "revised",
      note: `Artifacts updated after feedback (${artifacts.length} items)`,
    });
    this.persist();
    return draft;
  }

  markCommitted(
    id: string,
    committed: Array<{ ref: string; key: string }>,
  ): Draft {
    const draft = this.getOrThrow(id);
    const now = new Date().toISOString();
    for (const { ref, key } of committed) {
      const artifact = draft.artifacts.find((a) => a.ref === ref);
      if (artifact) artifact.committedKey = key;
    }
    draft.status = "committed";
    draft.updatedAt = now;
    draft.actionLog.push({
      timestamp: now,
      action: "committed",
      items: committed.map(({ ref, key }) => `${ref} → ${key}`),
    });
    this.persist();
    return draft;
  }

  delete(id: string): void {
    this.drafts.delete(id);
    this.persist();
  }

  // ─── Formatting ─────────────────────────────────────────────────────────────

  formatReviewSummary(draft: Draft): string {
    const shortId = draft.id.slice(0, 8);
    const out: string[] = [];

    // ── Header ──────────────────────────────────────────────────────────────
    out.push(`## JIRA Draft Review — \`${shortId}…\``);
    out.push("");
    out.push(`| | |`);
    out.push(`|---|---|`);
    out.push(`| **Project** | ${draft.projectKey} |`);
    out.push(
      `| **Status** | ${draft.status.toUpperCase().replace(/_/g, " ")} |`,
    );
    out.push(`| **Created** | ${new Date(draft.createdAt).toLocaleString()} |`);
    out.push(`| **Context** | ${draft.meetingContext} |`);
    if (draft.feedback) {
      out.push(`| **Feedback** | ⚠️ ${draft.feedback} |`);
    }
    out.push("");
    out.push("---");
    out.push("");
    out.push("### Select the issues to create in JIRA:");
    out.push("");

    // ── Group by type ───────────────────────────────────────────────────────
    const ORDER = ["Epic", "Story", "Task", "Bug", "Spike", "Sub-task"];
    const ICONS: Record<string, string> = {
      Epic: "🟣",
      Story: "🔵",
      Task: "🟢",
      Bug: "🔴",
      Spike: "🟡",
      "Sub-task": "⚪",
    };
    const groups = new Map<string, DraftArtifact[]>();
    for (const a of draft.artifacts) {
      const bucket = groups.get(a.type) ?? [];
      bucket.push(a);
      groups.set(a.type, bucket);
    }

    let totalPoints = 0;
    for (const type of ORDER) {
      const items = groups.get(type);
      if (!items?.length) continue;

      const icon = ICONS[type] ?? "•";
      out.push(`#### ${icon} ${type}s (${items.length})`);
      out.push("");

      for (const a of items) {
        const pts = a.storyPoints ?? 0;
        totalPoints += pts;
        const flag = a.flaggedForReview ? " ⚑" : "";
        out.push(
          `- [ ] **${a.ref}** — ${a.summary} _(${a.priority} · ${pts} pt${pts !== 1 ? "s" : ""})_${flag}`,
        );
        if (a.epicRef || a.epicLinkKey)
          out.push(`  > Epic: ${a.epicRef ?? a.epicLinkKey}`);
        if (a.parentRef || a.parentKey)
          out.push(`  > Parent: ${a.parentRef ?? a.parentKey}`);
        if (a.acceptanceCriteria?.length) {
          out.push(
            `  > **✅ AC:** ${a.acceptanceCriteria.map((c) => `*${c}*`).join(" · ")}`,
          );
        }
        if (a.testingScenarios?.length) {
          out.push(
            `  > **🧪 Tests:** ${a.testingScenarios.map((s) => `*${s}*`).join(" · ")}`,
          );
        }
        if (a.edgeCases?.length) {
          out.push(
            `  > **⚠️ Edge cases:** ${a.edgeCases.map((e) => `*${e}*`).join(" · ")}`,
          );
        }
        if (a.possibleBugs?.length) {
          out.push(
            `  > **🐛 Risks:** ${a.possibleBugs.map((b) => `*${b}*`).join(" · ")}`,
          );
        }
        if (a.labels?.length)
          out.push(`  > Labels: \`${a.labels.join("\`, \`")}\``);
        if (a.assigneeId) out.push(`  > Assignee: ${a.assigneeId}`);
        if (a.notes) out.push(`  > ℹ️ ${a.notes}`);
      }
      out.push("");
    }

    // ── Footer ──────────────────────────────────────────────────────────────
    out.push("---");
    out.push("");
    out.push(
      `**Total:** ${draft.artifacts.length} item${draft.artifacts.length !== 1 ? "s" : ""} · ${totalPoints} story point${totalPoints !== 1 ? "s" : ""}`,
    );
    out.push("");
    out.push("---");
    out.push("");
    out.push("> **How to respond:**");
    out.push('> - ✅ **Approve all** → say *"approve all"*');
    out.push(
      '> - ✅ **Approve selected** → say *"approve EPIC-01, STORY-02"* (list the refs you want)',
    );
    out.push(
      '> - ❌ **Reject with feedback** → say *"reject — [your feedback here]"*',
    );
    out.push("");
    out.push(`\`Draft ID: ${draft.id}\``);

    return out.join("\n");
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private getOrThrow(id: string): Draft {
    const draft = this.drafts.get(id);
    if (!draft) throw new Error(`Draft not found: ${id}`);
    return draft;
  }

  private assertStatus(
    draft: Draft,
    allowed: DraftStatus[],
    action: string,
  ): void {
    if (!allowed.includes(draft.status)) {
      throw new Error(
        `Cannot ${action} draft in status "${draft.status}". ` +
          `Allowed from: ${allowed.join(", ")}.`,
      );
    }
  }
}

export { DraftManager };
export const draftManager = new DraftManager(Config.draftStoragePath);
