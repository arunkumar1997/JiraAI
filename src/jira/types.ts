// ─── Primitive Types ──────────────────────────────────────────────────────────

export type IssuePriority = "Highest" | "High" | "Medium" | "Low" | "Lowest";
export type IssueType =
  | "Epic"
  | "Story"
  | "Task"
  | "Bug"
  | "Sub-task"
  | "Spike";
export type FibonacciPoints = 1 | 2 | 3 | 5 | 8 | 13 | 21;

// ─── JIRA REST API Shapes ─────────────────────────────────────────────────────

export interface JiraIssueFields {
  summary: string;
  description?: string;
  issuetype: { name: string };
  project: { key: string };
  priority?: { name: IssuePriority };
  labels?: string[];
  components?: Array<{ name: string }>;
  assignee?: { accountId: string } | null;
  reporter?: { accountId: string };
  parent?: { key: string };
  [key: string]: unknown; // custom fields (story points, epic link, etc.)
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description?: string;
    issuetype: { id: string; name: string; subtask: boolean };
    status: {
      name: string;
      statusCategory: { id: number; key: string; name: string };
    };
    priority: { name: IssuePriority };
    assignee?: {
      accountId: string;
      displayName: string;
      emailAddress: string;
    } | null;
    reporter?: { accountId: string; displayName: string };
    created: string;
    updated: string;
    labels: string[];
    components: Array<{ id: string; name: string }>;
    [key: string]: unknown;
  };
}

export interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
  startAt: number;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: "active" | "closed" | "future";
  startDate?: string;
  endDate?: string;
  goal?: string;
  originBoardId?: number;
}

export interface JiraBoard {
  id: number;
  name: string;
  type: "scrum" | "kanban";
  location: {
    projectId: number;
    projectKey: string;
    projectName: string;
  };
}

export interface JiraTransition {
  id: string;
  name: string;
  to: {
    id: string;
    name: string;
    statusCategory: { key: string; name: string };
  };
  isGlobal: boolean;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress: string;
  active: boolean;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  issueTypes: Array<{ id: string; name: string; subtask: boolean }>;
  components: Array<{ id: string; name: string }>;
}

export interface JiraLinkType {
  id: string;
  name: string;
  inward: string;
  outward: string;
}

// ─── Draft / AI Orchestration Types ──────────────────────────────────────────

export type DraftStatus =
  | "pending_review" // Created, awaiting human review
  | "approved" // All items approved
  | "partial" // Some items approved
  | "rejected" // Rejected — needs revision
  | "committed"; // Successfully committed to JIRA

export interface DraftArtifact {
  /** Local reference within this draft (e.g. "EPIC-01", "STORY-03") */
  ref: string;
  type: IssueType;
  summary: string;
  description: string;
  priority: IssuePriority;
  storyPoints: FibonacciPoints;
  acceptanceCriteria?: string[];
  labels?: string[];
  components?: string[];

  /** Ref to an Epic artifact in the same draft */
  epicRef?: string;
  /** Ref to a parent artifact in the same draft (for Sub-tasks) */
  parentRef?: string;

  /** Existing JIRA Epic key to link this issue to */
  epicLinkKey?: string;
  /** Existing JIRA issue key for Sub-task parent */
  parentKey?: string;

  assigneeId?: string;
  sprintId?: number;

  /** True when story points were auto-defaulted — human should verify */
  flaggedForReview?: boolean;
  /** AI reasoning notes for human context */
  notes?: string;

  /** Step-by-step testing scenarios (happy path + negative) */
  testingScenarios?: string[];
  /** Edge cases the implementation must handle */
  edgeCases?: string[];
  /** Anticipated bugs or risks to watch out for */
  possibleBugs?: string[];

  /** Set after the issue is committed to JIRA */
  committedKey?: string;
}

export interface DraftAction {
  timestamp: string;
  action: string;
  items?: string[];
  note?: string;
}

export interface Draft {
  id: string;
  createdAt: string;
  updatedAt: string;
  projectKey: string;
  meetingContext: string;
  status: DraftStatus;
  artifacts: DraftArtifact[];
  feedback?: string;
  actionLog: DraftAction[];
}
