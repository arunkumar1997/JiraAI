import { randomUUID } from "crypto";
import { Config } from "../config.js";
import { logger } from "../utils/logger.js";
import { database } from "../utils/database.js";
import type { Draft, DraftArtifact, DraftStatus } from "../jira/types.js";

// ─── Draft State Machine ──────────────────────────────────────────────────────
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
  constructor() {
    logger.info("Draft manager initialized with SQLite storage");
  }

  // ─── Persistence (SQLite) ─────────────────────────────────────────────────────────────

  private loadDraftFromDb(id: string): Draft | undefined {
    try {
      const stmt = database.prepare("SELECT * FROM drafts WHERE id = ?");
      const draftRow = stmt.get(id) as any;
      if (!draftRow) return undefined;

      // Load artifacts
      const artifactsStmt = database.prepare(
        "SELECT * FROM draft_artifacts WHERE draftId = ?",
      );
      const artifactRows = artifactsStmt.all(id) as any[];
      const artifacts = artifactRows.map((row: any) => ({
        ref: row.ref,
        type: row.type,
        summary: row.summary,
        description: row.description,
        priority: row.priority,
        storyPoints: row.storyPoints,
        acceptanceCriteria: row.acceptanceCriteria
          ? JSON.parse(row.acceptanceCriteria)
          : [],
        testingScenarios: row.testingScenarios
          ? JSON.parse(row.testingScenarios)
          : [],
        edgeCases: row.edgeCases ? JSON.parse(row.edgeCases) : [],
        possibleBugs: row.possibleBugs ? JSON.parse(row.possibleBugs) : [],
        labels: row.labels ? JSON.parse(row.labels) : [],
        components: row.components ? JSON.parse(row.components) : [],
        epicRef: row.epicRef,
        parentRef: row.parentRef,
        epicLinkKey: row.epicLinkKey,
        parentKey: row.parentKey,
        assigneeId: row.assigneeId,
        sprintId: row.sprintId,
        flaggedForReview: row.flaggedForReview === 1,
        notes: row.notes,
        committedKey: row.committedKey,
      }));

      // Load action logs
      const logsStmt = database.prepare(
        "SELECT * FROM draft_action_logs WHERE draftId = ? ORDER BY timestamp",
      );
      const logRows = logsStmt.all(id) as any[];
      const actionLog = logRows.map((row: any) => ({
        timestamp: row.timestamp,
        action: row.action,
        note: row.note,
        items: row.items ? JSON.parse(row.items) : undefined,
      }));

      return {
        id: draftRow.id,
        createdAt: draftRow.createdAt,
        updatedAt: draftRow.updatedAt,
        projectKey: draftRow.projectKey,
        meetingContext: draftRow.meetingContext,
        status: draftRow.status as DraftStatus,
        artifacts,
        actionLog,
        feedback: draftRow.feedback,
      };
    } catch (err) {
      logger.error("Failed to load draft from DB", { err });
      return undefined;
    }
  }

  private persistDraft(draft: Draft): void {
    try {
      database.transaction(() => {
        // Insert/update draft
        const updateStmt = database.prepare(
          `INSERT INTO drafts (id, projectKey, meetingContext, status, feedback, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           feedback = excluded.feedback,
           updatedAt = excluded.updatedAt`,
        );
        updateStmt.run(
          draft.id,
          draft.projectKey,
          draft.meetingContext,
          draft.status,
          draft.feedback || null,
          draft.createdAt,
          draft.updatedAt,
        );

        // Delete old artifacts
        const deleteArtsStmt = database.prepare(
          "DELETE FROM draft_artifacts WHERE draftId = ?",
        );
        deleteArtsStmt.run(draft.id);

        // Insert new artifacts
        const artStmt = database.prepare(
          `INSERT INTO draft_artifacts
           (id, draftId, ref, type, summary, description, priority, storyPoints,
            acceptanceCriteria, testingScenarios, edgeCases, possibleBugs, labels,
            components, epicRef, parentRef, epicLinkKey, parentKey, assigneeId,
            sprintId, flaggedForReview, notes, committedKey)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );

        for (const art of draft.artifacts) {
          artStmt.run(
            randomUUID(),
            draft.id,
            art.ref,
            art.type,
            art.summary,
            art.description,
            art.priority,
            art.storyPoints,
            art.acceptanceCriteria?.length
              ? JSON.stringify(art.acceptanceCriteria)
              : null,
            art.testingScenarios?.length
              ? JSON.stringify(art.testingScenarios)
              : null,
            art.edgeCases?.length ? JSON.stringify(art.edgeCases) : null,
            art.possibleBugs?.length ? JSON.stringify(art.possibleBugs) : null,
            art.labels?.length ? JSON.stringify(art.labels) : null,
            art.components?.length ? JSON.stringify(art.components) : null,
            art.epicRef || null,
            art.parentRef || null,
            art.epicLinkKey || null,
            art.parentKey || null,
            art.assigneeId || null,
            art.sprintId || null,
            art.flaggedForReview ? 1 : 0,
            art.notes || null,
            art.committedKey || null,
          );
        }

        // Delete old logs
        const deleteLogsStmt = database.prepare(
          "DELETE FROM draft_action_logs WHERE draftId = ?",
        );
        deleteLogsStmt.run(draft.id);

        // Insert new logs
        const logStmt = database.prepare(
          `INSERT INTO draft_action_logs (id, draftId, timestamp, action, note, items)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );

        for (const log of draft.actionLog) {
          logStmt.run(
            randomUUID(),
            draft.id,
            log.timestamp,
            log.action,
            log.note || null,
            log.items ? JSON.stringify(log.items) : null,
          );
        }
      });
    } catch (err) {
      logger.warn("Draft manager: could not persist draft", { err });
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────────

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
    this.persistDraft(draft);
    logger.info("Draft created", { draftId: id, artifacts: artifacts.length });
    return draft;
  }

  get(id: string): Draft | undefined {
    return this.loadDraftFromDb(id);
  }

  list(): Draft[] {
    try {
      const stmt = database.prepare(
        "SELECT id FROM drafts ORDER BY createdAt DESC",
      );
      const rows = stmt.all() as any[];
      return rows
        .map((row: any) => this.loadDraftFromDb(row.id))
        .filter((d): d is Draft => d !== undefined);
    } catch (err) {
      logger.error("Failed to list drafts", { err });
      return [];
    }
  }

  // ─── State Transitions ───────────────────────────────────────────────────────

  approve(id: string, refs: string[] | "all"): Draft {
    const draft = this.getOrThrow(id);
    // Idempotent behavior: repeated approval requests should be safe no-ops.
    if (draft.status === "approved") {
      return draft;
    }

    // Allow promoting a partially approved draft to fully approved.
    if (draft.status === "partial" && refs === "all") {
      const now = new Date().toISOString();
      draft.status = "approved";
      draft.updatedAt = now;
      draft.actionLog.push({ timestamp: now, action: "approved_all" });
      this.persistDraft(draft);
      return draft;
    }

    if (draft.status === "partial") {
      return draft;
    }

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
    this.persistDraft(draft);
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
    this.persistDraft(draft);
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
    this.persistDraft(draft);
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
    this.persistDraft(draft);
    return draft;
  }

  delete(id: string): void {
    try {
      const stmt = database.prepare("DELETE FROM drafts WHERE id = ?");
      stmt.run(id);
    } catch (err) {
      logger.error("Failed to delete draft", { err });
    }
  }

  // ─── Formatting ───────────────────────────────────────────────────────────────

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
    const ORDER: Array<string> = [
      "Epic",
      "Story",
      "Task",
      "Bug",
      "Spike",
      "Sub-task",
    ];
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

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private getOrThrow(id: string): Draft {
    const draft = this.loadDraftFromDb(id);
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
export const draftManager = new DraftManager();
