import * as vscode from "vscode";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ─── Types (mirrored from server — no import across bundles) ─────────────────

interface DraftArtifact {
  ref: string;
  type: string;
  summary: string;
  priority: string;
  storyPoints?: number;
  flaggedForReview?: boolean;
  committedKey?: string;
}

interface ActionLogEntry {
  timestamp: string;
  action: string;
  note?: string;
  items?: string[];
}

interface Draft {
  id: string;
  projectKey: string;
  meetingContext: string;
  status: string;
  artifacts: DraftArtifact[];
  createdAt: string;
  updatedAt: string;
  feedback?: string;
  actionLog: ActionLogEntry[];
}

interface ArtifactQuickPickItem extends vscode.QuickPickItem {
  ref: string;
}

interface DraftQuickPickItem extends vscode.QuickPickItem {
  draftId: string;
}

const DRAFTS_PATH = join(homedir(), ".jira-ai-mcp", ".drafts.json");

const TYPE_ICONS: Record<string, string> = {
  Epic: "$(organization)",
  Story: "$(book)",
  Task: "$(tasklist)",
  Bug: "$(bug)",
  Spike: "$(beaker)",
  "Sub-task": "$(list-tree)",
};

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  warnIfNotConfigured();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("jiraAiMcp")) warnIfNotConfigured();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("jiraAiMcp.openSettings", () => {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "jiraAiMcp",
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("jiraAiMcp.checkConnection", () => {
      const pat = vscode.workspace
        .getConfiguration("jiraAiMcp")
        .get<string>("pat");
      if (!pat) {
        vscode.window
          .showErrorMessage(
            "JIRA AI MCP: No Personal Access Token configured.",
            "Open Settings",
          )
          .then((c) => {
            if (c === "Open Settings")
              vscode.commands.executeCommand("jiraAiMcp.openSettings");
          });
        return;
      }
      vscode.window.showInformationMessage(
        "JIRA AI MCP server is active. Use GitHub Copilot Chat to interact with your JIRA instance.",
      );
    }),
  );

  // ── Command: Review Draft (Quick Pick UI) ──────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jiraAiMcp.reviewDraft",
      reviewDraftCommand,
    ),
  );
}

export function deactivate(): void {}

// ─── Review Draft Quick Pick ──────────────────────────────────────────────────

async function reviewDraftCommand(): Promise<void> {
  // 1. Load drafts
  if (!existsSync(DRAFTS_PATH)) {
    vscode.window.showWarningMessage(
      "No JIRA AI drafts found. Ask Copilot to analyse a meeting summary first.",
    );
    return;
  }

  let data: Record<string, Draft>;
  try {
    data = JSON.parse(readFileSync(DRAFTS_PATH, "utf-8")) as Record<
      string,
      Draft
    >;
  } catch {
    vscode.window.showErrorMessage(
      `Could not read drafts file: ${DRAFTS_PATH}`,
    );
    return;
  }

  const pending = Object.values(data).filter(
    (d) => d.status === "pending_review" || d.status === "rejected",
  );

  if (!pending.length) {
    vscode.window.showWarningMessage(
      "No drafts are awaiting review. All drafts are already approved or committed.",
    );
    return;
  }

  // 2. Pick a draft (if more than one pending)
  let draft: Draft;
  if (pending.length === 1) {
    draft = pending[0];
  } else {
    const draftItems: DraftQuickPickItem[] = pending.map((d) => ({
      label: `$(notebook) ${d.projectKey} — ${d.artifacts.length} item${d.artifacts.length !== 1 ? "s" : ""}`,
      description:
        d.status === "rejected" ? `⚑ REJECTED · ${d.feedback ?? ""}` : "",
      detail: `${d.meetingContext.slice(0, 80)} · Created ${new Date(d.createdAt).toLocaleString()} · ID: ${d.id.slice(0, 8)}…`,
      draftId: d.id,
    }));

    const picked = await vscode.window.showQuickPick<DraftQuickPickItem>(
      draftItems,
      {
        title: "JIRA AI — Select Draft to Review",
        placeHolder: "Choose a draft",
        matchOnDetail: true,
      },
    );
    if (!picked) return;
    draft = data[picked.draftId];
  }

  // 3. Show artifacts as multi-select checkboxes
  const ORDER = ["Epic", "Story", "Task", "Bug", "Spike", "Sub-task"];
  const sorted = [...draft.artifacts].sort(
    (a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type),
  );

  const artifactItems: ArtifactQuickPickItem[] = sorted.map((a) => ({
    label: `${TYPE_ICONS[a.type] ?? "$(circle-outline)"} [${a.ref}] ${a.summary}`,
    description: `${a.type} · ${a.priority} · ${a.storyPoints ?? 0} pt${(a.storyPoints ?? 0) !== 1 ? "s" : ""}${a.flaggedForReview ? "  ⚑ needs review" : ""}`,
    detail: a.committedKey
      ? `Already committed → ${a.committedKey}`
      : undefined,
    picked: !a.committedKey, // pre-check uncommitted items
    ref: a.ref,
  }));

  const totalPts = draft.artifacts.reduce(
    (s, a) => s + (a.storyPoints ?? 0),
    0,
  );

  const selected = await vscode.window.showQuickPick<ArtifactQuickPickItem>(
    artifactItems,
    {
      title: `JIRA AI — Review Draft · ${draft.projectKey} · ${draft.artifacts.length} items · ${totalPts} pts`,
      placeHolder:
        "✔ Tick items to approve  ✘ Untick to exclude  (Select none → reject with feedback)",
      canPickMany: true,
      matchOnDescription: true,
    },
  );

  if (selected === undefined) return; // user pressed Escape

  // 4a. No items selected → offer reject with feedback
  if (selected.length === 0) {
    const feedback = await vscode.window.showInputBox({
      title: "JIRA AI — Reject Draft",
      prompt:
        "Provide feedback for revision (leave blank to cancel without rejecting)",
      placeHolder: "e.g. Split STORY-02 into smaller stories, add AC to tasks",
      ignoreFocusOut: true,
    });
    if (!feedback) return;

    applyRejection(data, draft, feedback);
    vscode.window
      .showWarningMessage(
        `Draft rejected. Tell Copilot: "revise draft ${draft.id.slice(0, 8)}"`,
        "Copy Draft ID",
      )
      .then((c) => {
        if (c === "Copy Draft ID")
          vscode.env.clipboard
            .writeText(draft.id)
            .then(() =>
              vscode.window.showInformationMessage(
                "Draft ID copied to clipboard",
              ),
            );
      });
    return;
  }

  // 4b. Items selected → approve
  const refs = selected.map((s) => s.ref);
  const allApproved =
    refs.length === draft.artifacts.filter((a) => !a.committedKey).length;
  applyApproval(data, draft, refs, allApproved);

  const msg = `✅ ${refs.length} item${refs.length !== 1 ? "s" : ""} approved. Tell Copilot: "commit draft ${draft.id.slice(0, 8)}"`;
  vscode.window
    .showInformationMessage(msg, "Copy Draft ID", "Copy Commit Command")
    .then((c) => {
      if (c === "Copy Draft ID") {
        vscode.env.clipboard
          .writeText(draft.id)
          .then(() =>
            vscode.window.showInformationMessage(
              "Draft ID copied to clipboard",
            ),
          );
      } else if (c === "Copy Commit Command") {
        vscode.env.clipboard
          .writeText(`commit draft ${draft.id}`)
          .then(() =>
            vscode.window.showInformationMessage(
              "Command copied — paste it into Copilot Chat",
            ),
          );
      }
    });
}

// ─── Draft Mutation Helpers ───────────────────────────────────────────────────

function applyApproval(
  data: Record<string, Draft>,
  draft: Draft,
  refs: string[],
  isAll: boolean,
): void {
  const now = new Date().toISOString();
  data[draft.id].status = isAll ? "approved" : "partial";
  data[draft.id].updatedAt = now;
  data[draft.id].actionLog.push({
    timestamp: now,
    action: isAll ? "approved_all" : "approved_partial",
    ...(isAll ? {} : { items: refs }),
  });
  persistDrafts(data);
}

function applyRejection(
  data: Record<string, Draft>,
  draft: Draft,
  feedback: string,
): void {
  const now = new Date().toISOString();
  data[draft.id].status = "rejected";
  data[draft.id].feedback = feedback;
  data[draft.id].updatedAt = now;
  data[draft.id].actionLog.push({
    timestamp: now,
    action: "rejected",
    note: feedback,
  });
  persistDrafts(data);
}

function persistDrafts(data: Record<string, Draft>): void {
  writeFileSync(DRAFTS_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function warnIfNotConfigured(): void {
  const pat = vscode.workspace.getConfiguration("jiraAiMcp").get<string>("pat");
  if (!pat) {
    vscode.window
      .showWarningMessage(
        "JIRA AI MCP: Personal Access Token is not set. The MCP server will not be able to connect to JIRA.",
        "Open Settings",
      )
      .then((c) => {
        if (c === "Open Settings")
          vscode.commands.executeCommand("jiraAiMcp.openSettings");
      });
  }
}
