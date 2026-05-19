import { randomUUID } from "crypto";
import { logger } from "../utils/logger.js";
import { prisma } from "../utils/database.js";
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
    logger.info("Draft manager initialized with PostgreSQL (Prisma) storage");
  }

  // ─── Persistence (Prisma / PostgreSQL) ───────────────────────────────────────

  private async loadDraftFromDb(id: string): Promise<Draft | undefined> {
    try {
      const row = await prisma.draft.findUnique({
        where: { id },
        include: {
          artifacts: true,
          actionLogs: { orderBy: { timestamp: "asc" } },
        },
      });
      if (!row) return undefined;

      const artifacts: DraftArtifact[] = row.artifacts.map((a) => ({
        ref: a.ref,
        type: a.type as DraftArtifact["type"],
        summary: a.summary,
        description: a.description,
        priority: (a.priority ?? "Medium") as DraftArtifact["priority"],
        storyPoints: (a.storyPoints ?? 3) as DraftArtifact["storyPoints"],
        acceptanceCriteria: a.acceptanceCriteria
          ? (JSON.parse(a.acceptanceCriteria) as string[])
          : [],
        testingScenarios: a.testingScenarios
          ? (JSON.parse(a.testingScenarios) as string[])
          : [],
        edgeCases: a.edgeCases ? (JSON.parse(a.edgeCases) as string[]) : [],
        possibleBugs: a.possibleBugs
          ? (JSON.parse(a.possibleBugs) as string[])
          : [],
        labels: a.labels ? (JSON.parse(a.labels) as string[]) : [],
        components: a.components
          ? (JSON.parse(a.components) as string[])
          : [],
        epicRef: a.epicRef ?? undefined,
        parentRef: a.parentRef ?? undefined,
        epicLinkKey: a.epicLinkKey ?? undefined,
        parentKey: a.parentKey ?? undefined,
        assigneeId: a.assigneeId ?? undefined,
        sprintId: a.sprintId ?? undefined,
        flaggedForReview: a.flaggedForReview,
        notes: a.notes ?? undefined,
        committedKey: a.committedKey ?? undefined,
      }));

      const actionLog = row.actionLogs.map((l) => ({
        timestamp: l.timestamp.toISOString(),
        action: l.action,
        note: l.note ?? undefined,
        items: l.items ? (JSON.parse(l.items) as string[]) : undefined,
      }));

      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        projectKey: row.projectKey,
        meetingContext: row.meetingContext,
        status: row.status as DraftStatus,
        artifacts,
        actionLog,
        feedback: row.feedback ?? undefined,
      };
    } catch (err) {
      logger.error("Failed to load draft from DB", { err });
      return undefined;
    }
  }

  private async persistDraft(draft: Draft): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.draft.upsert({
          where: { id: draft.id },
          create: {
            id: draft.id,
            projectKey: draft.projectKey,
            meetingContext: draft.meetingContext,
            status: draft.status,
            feedback: draft.feedback ?? null,
            createdAt: new Date(draft.createdAt),
            updatedAt: new Date(draft.updatedAt),
          },
          update: {
            status: draft.status,
            feedback: draft.feedback ?? null,
            updatedAt: new Date(draft.updatedAt),
          },
        });

        await tx.draftArtifact.deleteMany({ where: { draftId: draft.id } });
        await tx.draftArtifact.createMany({
          data: draft.artifacts.map((art) => ({
            id: randomUUID(),
            draftId: draft.id,
            ref: art.ref,
            type: art.type,
            summary: art.summary,
            description: art.description,
            priority: art.priority ?? "Medium",
            storyPoints: art.storyPoints ?? 3,
            acceptanceCriteria: art.acceptanceCriteria?.length
              ? JSON.stringify(art.acceptanceCriteria)
              : null,
            testingScenarios: art.testingScenarios?.length
              ? JSON.stringify(art.testingScenarios)
              : null,
            edgeCases: art.edgeCases?.length
              ? JSON.stringify(art.edgeCases)
              : null,
            possibleBugs: art.possibleBugs?.length
              ? JSON.stringify(art.possibleBugs)
              : null,
            labels: art.labels?.length ? JSON.stringify(art.labels) : null,
            components: art.components?.length
              ? JSON.stringify(art.components)
              : null,
            epicRef: art.epicRef ?? null,
            parentRef: art.parentRef ?? null,
            epicLinkKey: art.epicLinkKey ?? null,
            parentKey: art.parentKey ?? null,
            assigneeId: art.assigneeId ?? null,
            sprintId: art.sprintId ?? null,
            flaggedForReview: art.flaggedForReview ?? false,
            notes: art.notes ?? null,
            committedKey: art.committedKey ?? null,
          })),
        });

        await tx.draftActionLog.deleteMany({ where: { draftId: draft.id } });
        await tx.draftActionLog.createMany({
          data: draft.actionLog.map((log) => ({
            id: randomUUID(),
            draftId: draft.id,
            timestamp: new Date(log.timestamp),
            action: log.action,
            note: log.note ?? null,
            items: log.items ? JSON.stringify(log.items) : null,
          })),
        });
      });
    } catch (err) {
      logger.warn("Draft manager: could not persist draft", { err });
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────────

  async create(
    projectKey: string,
    meetingContext: string,
    artifacts: DraftArtifact[],
  ): Promise<Draft> {
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
    await this.persistDraft(draft);
    logger.info("Draft created", { draftId: id, artifacts: artifacts.length });
    return draft;
  }

  async get(id: string): Promise<Draft | undefined> {
    return this.loadDraftFromDb(id);
  }

  async list(): Promise<Draft[]> {
    try {
      const rows = await prisma.draft.findMany({
        select: { id: true },
        orderBy: { createdAt: "desc" },
      });
      const drafts = await Promise.all(
        rows.map((r) => this.loadDraftFromDb(r.id)),
      );
      return drafts.filter((d): d is Draft => d !== undefined);
    } catch (err) {
      logger.error("Failed to list drafts", { err });
      return [];
    }
  }

  // ─── State Transitions ───────────────────────────────────────────────────────

  async approve(id: string, refs: string[] | "all"): Promise<Draft> {
    const draft = await this.getOrThrow(id);
    if (draft.status === "approved") {
      return draft;
    }

    if (draft.status === "partial" && refs === "all") {
      const now = new Date().toISOString();
      draft.status = "approved";
      draft.updatedAt = now;
      draft.actionLog.push({ timestamp: now, action: "approved_all" });
      await this.persistDraft(draft);
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
    await this.persistDraft(draft);
    return draft;
  }

  async reject(id: string, feedback: string): Promise<Draft> {
    const draft = await this.getOrThrow(id);
    this.assertStatus(draft, ["pending_review"], "reject");
    const now = new Date().toISOString();
    draft.status = "rejected";
    draft.feedback = feedback;
    draft.updatedAt = now;
    draft.actionLog.push({ timestamp: now, action: "rejected", note: feedback });
    await this.persistDraft(draft);
    return draft;
  }

  async revise(id: string, artifacts: DraftArtifact[]): Promise<Draft> {
    const draft = await this.getOrThrow(id);
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
    await this.persistDraft(draft);
    return draft;
  }

  async markCommitted(
    id: string,
    committed: Array<{ ref: string; key: string }>,
  ): Promise<Draft> {
    const draft = await this.getOrThrow(id);
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
    await this.persistDraft(draft);
    return draft;
  }

  async delete(id: string): Promise<void> {
    try {
      await prisma.draft.delete({ where: { id } });
    } catch (err) {
      logger.error("Failed to delete draft", { err });
    }
  }

  // ─── Formatting ───────────────────────────────────────────────────────────────

  formatReviewSummary(draft: Draft): string {
    const shortId = draft.id.slice(0, 8);
    const out: string[] = [];

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

  private async getOrThrow(id: string): Promise<Draft> {
    const draft = await this.loadDraftFromDb(id);
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
