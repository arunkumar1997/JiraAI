/**
 * Unit tests for comment-tools handleCommentTool.
 */
import { jest } from "@jest/globals";

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

const mockAddComment: jest.Mock = jest.fn();

jest.unstable_mockModule("../../jira/client.js", () => ({
  jiraClient: {
    addComment: mockAddComment,
  },
}));

const { handleCommentTool } = await import("../../tools/comment-tools.js");

beforeEach(() => jest.clearAllMocks());

describe("handleCommentTool — jira_add_comment", () => {
  it("adds a comment and returns confirmation string", async () => {
    mockAddComment.mockResolvedValueOnce(undefined);

    const result = await handleCommentTool("jira_add_comment", {
      issue_key: "TEST-5",
      body: "LGTM!",
    });

    expect(mockAddComment).toHaveBeenCalledWith("TEST-5", "LGTM!");
    expect(result).toContain("TEST-5");
    expect(result).toContain("Comment added");
  });

  it("passes the body text verbatim to the client", async () => {
    mockAddComment.mockResolvedValueOnce(undefined);
    const body = "Multi-line\n*bold* comment";

    await handleCommentTool("jira_add_comment", {
      issue_key: "TEST-7",
      body,
    });

    expect(mockAddComment).toHaveBeenCalledWith("TEST-7", body);
  });

  it("propagates errors from the Jira client", async () => {
    mockAddComment.mockRejectedValueOnce(new Error("404 Not Found"));

    await expect(
      handleCommentTool("jira_add_comment", {
        issue_key: "NONEXISTENT-1",
        body: "hello",
      }),
    ).rejects.toThrow("404 Not Found");
  });
});

describe("handleCommentTool — unknown tool", () => {
  it("throws for unknown tool name", async () => {
    await expect(handleCommentTool("jira_unknown_action", {})).rejects.toThrow(
      "Unknown comment tool",
    );
  });
});
