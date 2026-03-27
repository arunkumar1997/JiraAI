import axios, { type AxiosInstance, type AxiosError } from "axios";
import { Config } from "../config";
import { logger } from "../utils/logger";
import type {
  JiraIssueFields,
  JiraIssue,
  JiraSearchResult,
  JiraSprint,
  JiraBoard,
  JiraTransition,
  JiraUser,
  JiraProject,
} from "./types";

export class JiraClient {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: Config.jira.baseUrl,
      headers: {
        Authorization: `Bearer ${Config.jira.pat}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Atlassian-Token": "no-check",
      },
      timeout: 30_000,
    });

    this.http.interceptors.response.use(
      (res) => res,
      (err: AxiosError) => {
        const data = err.response?.data as Record<string, unknown> | undefined;
        logger.error("JIRA API error", {
          status: err.response?.status,
          url: err.config?.url,
          errorMessages: data?.errorMessages,
          errors: data?.errors,
        });
        throw err;
      },
    );
  }

  // ─── Issues ────────────────────────────────────────────────────────────────

  async createIssue(fields: JiraIssueFields): Promise<JiraIssue> {
    const res = await this.http.post<JiraIssue>("/rest/api/2/issue", {
      fields,
    });
    return res.data;
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    const res = await this.http.get<JiraIssue>(`/rest/api/2/issue/${issueKey}`);
    return res.data;
  }

  async updateIssue(
    issueKey: string,
    fields: Partial<JiraIssueFields>,
  ): Promise<void> {
    await this.http.put(`/rest/api/2/issue/${issueKey}`, { fields });
  }

  async deleteIssue(issueKey: string): Promise<void> {
    await this.http.delete(`/rest/api/2/issue/${issueKey}`);
  }

  async assignIssue(issueKey: string, accountId: string | null): Promise<void> {
    await this.http.put(`/rest/api/2/issue/${issueKey}/assignee`, {
      accountId,
    });
  }

  // ─── Issue Links ──────────────────────────────────────────────────────────

  async linkIssues(
    fromKey: string,
    toKey: string,
    linkTypeName: string,
  ): Promise<void> {
    await this.http.post("/rest/api/2/issueLink", {
      type: { name: linkTypeName },
      inwardIssue: { key: fromKey },
      outwardIssue: { key: toKey },
    });
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  async searchIssues(
    jql: string,
    maxResults = 50,
    startAt = 0,
  ): Promise<JiraSearchResult> {
    const res = await this.http.post<JiraSearchResult>("/rest/api/2/search", {
      jql,
      maxResults,
      startAt,
      fields: [
        "summary",
        "status",
        "issuetype",
        "priority",
        "assignee",
        "reporter",
        "created",
        "updated",
        "labels",
      ],
    });
    return res.data;
  }

  // ─── Comments ──────────────────────────────────────────────────────────────

  async addComment(issueKey: string, body: string): Promise<void> {
    await this.http.post(`/rest/api/2/issue/${issueKey}/comment`, { body });
  }

  // ─── Workflow Transitions ─────────────────────────────────────────────────

  async getTransitions(issueKey: string): Promise<JiraTransition[]> {
    const res = await this.http.get<{ transitions: JiraTransition[] }>(
      `/rest/api/2/issue/${issueKey}/transitions`,
    );
    return res.data.transitions;
  }

  async transitionIssue(
    issueKey: string,
    transitionId: string,
    comment?: string,
  ): Promise<void> {
    const body: Record<string, unknown> = { transition: { id: transitionId } };
    if (comment) {
      body.update = { comment: [{ add: { body: comment } }] };
    }
    await this.http.post(`/rest/api/2/issue/${issueKey}/transitions`, body);
  }

  // ─── Sprints (Agile API) ──────────────────────────────────────────────────

  async createSprint(
    boardId: number,
    name: string,
    goal: string,
    startDate?: string,
    endDate?: string,
  ): Promise<JiraSprint> {
    const res = await this.http.post<JiraSprint>("/rest/agile/1.0/sprint", {
      name,
      goal,
      startDate,
      endDate,
      originBoardId: boardId,
    });
    return res.data;
  }

  async updateSprint(
    sprintId: number,
    updates: Partial<
      Pick<JiraSprint, "name" | "goal" | "startDate" | "endDate" | "state">
    >,
  ): Promise<JiraSprint> {
    const res = await this.http.put<JiraSprint>(
      `/rest/agile/1.0/sprint/${sprintId}`,
      updates,
    );
    return res.data;
  }

  async moveIssuesToSprint(
    sprintId: number,
    issueKeys: string[],
  ): Promise<void> {
    await this.http.post(`/rest/agile/1.0/sprint/${sprintId}/issue`, {
      issues: issueKeys,
    });
  }

  async getBoard(boardId: number): Promise<JiraBoard> {
    const res = await this.http.get<JiraBoard>(
      `/rest/agile/1.0/board/${boardId}`,
    );
    return res.data;
  }

  async getBoardSprints(boardId: number): Promise<JiraSprint[]> {
    const res = await this.http.get<{ values: JiraSprint[] }>(
      `/rest/agile/1.0/board/${boardId}/sprint`,
    );
    return res.data.values;
  }

  // ─── Project ────────────────────────────────────────────────────────────────

  async getProject(projectKey: string): Promise<JiraProject> {
    const res = await this.http.get<JiraProject>(
      `/rest/api/2/project/${projectKey}?expand=issueTypes,components`,
    );
    return res.data;
  }

  // ─── Users ──────────────────────────────────────────────────────────────────

  async listAssignableUsers(projectKey: string): Promise<JiraUser[]> {
    const res = await this.http.get<JiraUser[]>(
      `/rest/api/2/user/assignable/search?project=${projectKey}&maxResults=50`,
    );
    return res.data;
  }

  // ─── Field Discovery ────────────────────────────────────────────────────────

  async getAllFields(): Promise<
    Array<{ id: string; name: string; custom: boolean }>
  > {
    const res = await this.http.get("/rest/api/2/field");
    return res.data;
  }
}

export const jiraClient = new JiraClient();
