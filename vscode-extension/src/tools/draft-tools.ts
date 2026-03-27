import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { draftManager } from "../ai/draft-manager";
import { jiraClient } from "../jira/client";
import { Config } from "../config";
import { logger } from "../utils/logger";
import type {
  DraftArtifact,
  IssuePriority,
  JiraIssueFields,
} from "../jira/types";

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const EXTRA_GUIDELINES = process.env["JIRA_ARTIFACT_GUIDELINES"]?.trim();
const CREATE_DRAFT_DESCRIPTION =
  "Store analyzed JIRA artifacts as a draft for human review. This does NOT commit anything to JIRA. " +
  "Call this after analyzing a meeting summary or requirements document.\n\n" +
  "QUALITY REQUIREMENTS — every artifact MUST include:\n" +
  "1. acceptanceCriteria — at least 3 specific, testable conditions (Given/When/Then style preferred)\n" +
  "2. testingScenarios — at least 2 scenarios: one happy-path and one failure/negative case\n" +
  "3. edgeCases — at least 2 edge cases (boundary values, empty/null inputs, concurrency, etc.)\n" +
  "4. possibleBugs — at least 1 anticipated risk or implementation pitfall\n" +
  "5. description — full structured description with background, scope, and out-of-scope items\n" +
  "6. priority and storyPoints — justified by complexity\n\n" +
  "Do NOT omit these fields. Incomplete artifacts will be rejected." +
  (EXTRA_GUIDELINES ? `\n\nADDITIONAL GUIDELINES:\n${EXTRA_GUIDELINES}` : "");

const ARTIFACT_ITEM_SCHEMA = {
  type: "object",
  properties: {
    ref: {
      type: "string",
      description: "Local reference (EPIC-01, STORY-02, BUG-01, etc.)",
    },
    type: {
      type: "string",
      enum: ["Epic", "Story", "Task", "Bug", "Sub-task", "Spike"],
    },
    summary: { type: "string", description: "Issue title — max 255 chars" },
    description: { type: "string", description: "Full structured description" },
    priority: {
      type: "string",
      enum: ["Highest", "High", "Medium", "Low", "Lowest"],
      default: "Medium",
    },
    storyPoints: { type: "number", enum: [1, 2, 3, 5, 8, 13, 21], default: 3 },
    acceptanceCriteria: { type: "array", items: { type: "string" } },
    labels: { type: "array", items: { type: "string" } },
    components: { type: "array", items: { type: "string" } },
    epicRef: {
      type: "string",
      description: "Ref of the Epic in this draft (e.g. EPIC-01)",
    },
    parentRef: {
      type: "string",
      description: "Ref of parent artifact (for Sub-tasks)",
    },
    epicLinkKey: {
      type: "string",
      description: "Existing JIRA Epic key (e.g. PROJ-5)",
    },
    parentKey: {
      type: "string",
      description: "Existing JIRA parent issue key",
    },
    assigneeId: { type: "string", description: "JIRA account ID for assignee" },
    sprintId: {
      type: "number",
      description: "Sprint ID to assign this issue to",
    },
    flaggedForReview: {
      type: "boolean",
      description: "True if auto-defaulted values need human review",
    },
    notes: { type: "string", description: "AI reasoning notes for reviewer" },
    testingScenarios: {
      type: "array",
      items: { type: "string" },
      minItems: 2,
      description:
        "Step-by-step testing scenarios — include happy path AND negative/failure cases",
      examples: [
        [
          "Happy path: Given a valid user, when they submit the form, then a success response is returned",
          "Failure case: Given an invalid token, when the API is called, then a 401 Unauthorized is returned",
        ],
      ],
    },
    edgeCases: {
      type: "array",
      items: { type: "string" },
      minItems: 2,
      description:
        "Edge cases the implementation must explicitly handle (e.g. empty input, concurrent requests, boundary values)",
      examples: [
        [
          "Empty string input should be treated as missing and return a validation error",
          "Concurrent requests with the same idempotency key should return the same result without double-processing",
        ],
      ],
    },
    possibleBugs: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      description:
        "Anticipated bugs, risks, or implementation pitfalls the developer should watch for",
      examples: [
        [
          "Race condition if two processes update the same record simultaneously without a lock",
          "Token expiry not handled — silent failures may occur if the refresh flow is skipped",
        ],
      ],
    },
  },
  required: ["ref", "type", "summary", "description"],
} as const;

export const draftToolDefinitions: Tool[] = [
  {
    name: "create_jira_draft",
    description: CREATE_DRAFT_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        project_key: {
          type: "string",
          description: `JIRA project key (default: ${Config.jira.projectKey})`,
          default: Config.jira.projectKey,
        },
        meeting_context: {
          type: "string",
          description:
            "Brief description of the meeting or source of these requirements",
        },
        artifacts: {
          type: "array",
          description:
            "Structured JIRA artifacts (Epics, Stories, Tasks, Bugs, Spikes, Sub-tasks)",
          items: ARTIFACT_ITEM_SCHEMA,
          minItems: 1,
        },
      },
      required: ["meeting_context", "artifacts"],
    },
  },
  {
    name: "get_jira_draft",
    description: "Retrieve and display a specific draft by ID.",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "UUID of the draft" },
      },
      required: ["draft_id"],
    },
  },
  {
    name: "list_jira_drafts",
    description: "List all drafts (pending, approved, rejected, committed).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "approve_jira_draft",
    description:
      'Mark a draft as approved. Use "all" to approve everything, or provide specific refs. ' +
      "After approval, call commit_jira_draft to push to JIRA.",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "UUID of the draft" },
        approve: {
          description:
            '"all" to approve all artifacts, or array of refs (["EPIC-01", "STORY-02"])',
          oneOf: [
            { type: "string", enum: ["all"] },
            { type: "array", items: { type: "string" }, minItems: 1 },
          ],
        },
      },
      required: ["draft_id", "approve"],
    },
  },
  {
    name: "reject_jira_draft",
    description: "Reject a draft with feedback for revision.",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
        feedback: {
          type: "string",
          description: "Specific feedback on what to change",
        },
      },
      required: ["draft_id", "feedback"],
    },
  },
  {
    name: "revise_jira_draft",
    description:
      "Replace artifacts in a rejected draft with revised versions and re-present for review.",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
        artifacts: { type: "array", items: ARTIFACT_ITEM_SCHEMA, minItems: 1 },
      },
      required: ["draft_id", "artifacts"],
    },
  },
  {
    name: "commit_jira_draft",
    description:
      "Commit approved draft artifacts to JIRA. REQUIRES prior approval via approve_jira_draft. " +
      "Creates issues in JIRA in the correct order (Epics first, then Stories, then Tasks/Bugs, then Sub-tasks). " +
      "Use dry_run=true to simulate without creating anything.",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string" },
        refs: {
          description:
            '"all" to commit all approved items, or array of specific refs',
          oneOf: [
            { type: "string", enum: ["all"] },
            { type: "array", items: { type: "string" } },
          ],
          default: "all",
        },
        dry_run: {
          type: "boolean",
          description: "Simulate the commit without creating anything in JIRA",
          default: false,
        },
      },
      required: ["draft_id"],
    },
  },
];

// ─── Tool Handlers ────────────────────────────────────────────────────────────

export async function handleDraftTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (toolName) {
    case "create_jira_draft": {
      const projectKey = (args.project_key as string) || Config.jira.projectKey;
      const meetingContext = args.meeting_context as string;
      const artifacts = args.artifacts as DraftArtifact[];
      const draft = draftManager.create(projectKey, meetingContext, artifacts);
      return draftManager.formatReviewSummary(draft);
    }

    case "get_jira_draft": {
      const draft = draftManager.get(args.draft_id as string);
      if (!draft) return `❌ Draft not found: ${args.draft_id as string}`;
      return draftManager.formatReviewSummary(draft);
    }

    case "list_jira_drafts": {
      const drafts = draftManager.list();
      if (!drafts.length) return "No drafts found.";
      return drafts
        .map((d) => {
          const age = Math.round(
            (Date.now() - new Date(d.createdAt).getTime()) / 60_000,
          );
          const context = d.meetingContext.slice(0, 55);
          return `[${d.id.slice(0, 8)}…] ${d.status.toUpperCase().padEnd(15)} ${d.artifacts.length} items | ${context}… (${age}m ago)`;
        })
        .join("\n");
    }

    case "approve_jira_draft": {
      const refs = args.approve as string[] | "all";
      const draft = draftManager.approve(args.draft_id as string, refs);
      const count =
        refs === "all" ? draft.artifacts.length : (refs as string[]).length;
      return (
        `✅ Draft approved (${count} item(s)).\n` +
        `Call commit_jira_draft with draft_id="${draft.id}" to push to JIRA.`
      );
    }

    case "reject_jira_draft": {
      const draft = draftManager.reject(
        args.draft_id as string,
        args.feedback as string,
      );
      return (
        `🔄 Draft ${draft.id} rejected.\n` +
        `Feedback recorded: ${args.feedback as string}\n` +
        `Call revise_jira_draft to update the artifacts.`
      );
    }

    case "revise_jira_draft": {
      const draft = draftManager.revise(
        args.draft_id as string,
        args.artifacts as DraftArtifact[],
      );
      return draftManager.formatReviewSummary(draft);
    }

    case "commit_jira_draft": {
      return await commitDraft(
        args.draft_id as string,
        (args.refs as string[] | "all") ?? "all",
        (args.dry_run as boolean) ?? false,
      );
    }

    default:
      throw new Error(`Unknown draft tool: ${toolName}`);
  }
}

// ─── Commit Logic ─────────────────────────────────────────────────────────────

async function commitDraft(
  draftId: string,
  refs: string[] | "all",
  dryRun: boolean,
): Promise<string> {
  const draft = draftManager.get(draftId);
  if (!draft) return `❌ Draft not found: ${draftId}`;

  if (!["approved", "partial"].includes(draft.status)) {
    return (
      `❌ Cannot commit — draft status is "${draft.status}".\n` +
      `Use approve_jira_draft first.`
    );
  }

  const ISSUE_ORDER = ["Epic", "Story", "Task", "Bug", "Spike", "Sub-task"];
  const candidates =
    refs === "all"
      ? draft.artifacts
      : draft.artifacts.filter((a) => (refs as string[]).includes(a.ref));

  if (!candidates.length) return `❌ No matching artifacts to commit.`;

  const sorted = [...candidates].sort(
    (a, b) => ISSUE_ORDER.indexOf(a.type) - ISSUE_ORDER.indexOf(b.type),
  );

  if (dryRun) {
    const lines = [
      `🔍 DRY RUN — nothing will be written to JIRA`,
      `Would commit ${sorted.length} artifact(s):`,
      "",
    ];
    for (const a of sorted) {
      lines.push(`  [${a.type.padEnd(8)}] [${a.ref}] ${a.summary}`);
      lines.push(`             ${a.priority} | ${a.storyPoints}pts`);
    }
    return lines.join("\n");
  }

  logger.info("Committing draft to JIRA", { draftId, count: sorted.length });

  const results: string[] = [];
  const committed: Array<{ ref: string; key: string }> = [];
  const refToKey: Record<string, string> = {};

  for (const artifact of sorted) {
    try {
      const fields = buildIssueFields(artifact, draft.projectKey, refToKey);
      const issue = await jiraClient.createIssue(fields);
      refToKey[artifact.ref] = issue.key;
      committed.push({ ref: artifact.ref, key: issue.key });
      results.push(`✅ [${artifact.ref}] → ${issue.key}  ${artifact.summary}`);
      logger.info("Issue created", { ref: artifact.ref, key: issue.key });

      if (artifact.storyPoints !== undefined && artifact.storyPoints !== null) {
        try {
          await jiraClient.updateIssue(issue.key, {
            [Config.jira.fields.storyPoints]: artifact.storyPoints,
          });
        } catch {
          /* non-fatal */
        }
      }
      // Set Epic Link via update — the field is often not on the Create screen
      if (!["Epic", "Sub-task"].includes(artifact.type)) {
        const epicKey =
          artifact.epicLinkKey ??
          (artifact.epicRef ? refToKey[artifact.epicRef] : undefined);
        if (epicKey) {
          try {
            await jiraClient.updateIssue(issue.key, {
              [Config.jira.fields.epicLink]: epicKey,
            });
          } catch {
            /* non-fatal — epic link field may not be on the Edit screen */
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push(`❌ [${artifact.ref}] FAILED: ${msg}`);
      logger.error("Failed to create issue", { ref: artifact.ref, error: msg });
    }
  }

  // Link Bugs to their parent story/epic (non-fatal)
  for (const artifact of sorted) {
    if (artifact.type !== "Bug") continue;
    const targetRef = artifact.epicRef ?? artifact.parentRef;
    if (targetRef && refToKey[artifact.ref] && refToKey[targetRef]) {
      try {
        await jiraClient.linkIssues(
          refToKey[artifact.ref],
          refToKey[targetRef],
          "Relates",
        );
      } catch {
        /* non-fatal */
      }
    }
  }

  if (committed.length) {
    draftManager.markCommitted(draftId, committed);
  }

  results.push("");
  results.push(
    `Committed ${committed.length} / ${sorted.length} issue(s) to JIRA.`,
  );
  return results.join("\n");
}

// ─── Field Builder ────────────────────────────────────────────────────────────

function buildIssueFields(
  artifact: DraftArtifact,
  projectKey: string,
  refToKey: Record<string, string>,
): JiraIssueFields {
  const { fields } = Config.jira;

  const issueFields: JiraIssueFields = {
    summary: artifact.summary,
    issuetype: { name: artifact.type === "Spike" ? "Story" : artifact.type },
    project: { key: projectKey },
    priority: { name: artifact.priority as IssuePriority },
    description: buildDescription(artifact),
    labels: [
      ...(artifact.labels ?? []),
      ...(artifact.type === "Spike" ? ["Spike"] : []),
      "ai-generated",
    ],
  };

  if (artifact.components?.length) {
    issueFields.components = artifact.components.map((name) => ({ name }));
  }

  if (artifact.assigneeId) {
    issueFields.assignee = { accountId: artifact.assigneeId };
  }

  // Epic name (required when creating an Epic)
  if (artifact.type === "Epic") {
    issueFields[fields.epicName] = artifact.summary;
  }

  // Epic link is set via a separate updateIssue call after creation
  // to avoid 400 errors when the field is not on the Create Issue screen.

  if (artifact.type === "Sub-task") {
    const parentKey =
      artifact.parentKey ??
      (artifact.parentRef ? refToKey[artifact.parentRef] : undefined);
    if (parentKey) {
      issueFields.parent = { key: parentKey };
    }
  }

  // Sprint is set via a separate updateIssue call after creation
  // to avoid 400 errors when the field is not on the Create Issue screen.

  return issueFields;
}

function buildDescription(artifact: DraftArtifact): string {
  const parts: string[] = [artifact.description, ""];

  if (artifact.acceptanceCriteria?.length) {
    parts.push("*Acceptance Criteria:*");
    for (const ac of artifact.acceptanceCriteria) {
      parts.push(`* ${ac}`);
    }
    parts.push("");
  }

  if (artifact.type === "Bug") {
    parts.push("*Reported by:* JIRA AI Agent");
    parts.push("");
  }

  parts.push("----");
  parts.push("_Generated by JIRA AI MCP Server. Review before closing._");
  return parts.join("\n");
}
