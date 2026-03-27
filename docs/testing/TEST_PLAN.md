# Test Plan — JIRA AI MCP Server

## Test Strategy Overview

| Layer       | Type                   | Tooling             | Coverage Target                         |
| ----------- | ---------------------- | ------------------- | --------------------------------------- |
| Unit        | Pure functions         | Jest                | DraftManager, field builder, formatters |
| Integration | MCP server + mock JIRA | Jest + MSW          | All 22 tools                            |
| End-to-End  | Full stack             | Manual / Playwright | Meeting → JIRA creation workflow        |
| Security    | OWASP checks           | Manual              | Auth, injection, secrets                |

---

## Unit Tests

### `DraftManager` (`src/__tests__/draft-manager.test.ts`)

```typescript
describe('DraftManager', () => {
  it('creates a draft with pending_review status', () => { ... });
  it('approves all items and returns approved status', () => { ... });
  it('partial approval sets partial status', () => { ... });
  it('rejects with feedback and records in actionLog', () => { ... });
  it('revise restores pending_review after rejection', () => { ... });
  it('cannot revise an approved draft', () => { ... });
  it('commit transitions to committed and sets committedKey', () => { ... });
  it('cannot commit without prior approval', () => { ... });
  it('persists to disk and reloads on init', () => { ... });
  it('formatReviewSummary includes all artifact types', () => { ... });
  it('formatReviewSummary shows flaggedForReview warning', () => { ... });
});
```

### Field Builder (`src/__tests__/field-builder.test.ts`)

```typescript
describe('buildIssueFields', () => {
  it('sets epicName custom field for Epic type', () => { ... });
  it('sets epicLink for Story using epicRef → refToKey', () => { ... });
  it('sets epicLink for Story using epicLinkKey directly', () => { ... });
  it('sets parent for Sub-task using parentRef → refToKey', () => { ... });
  it('sets parent for Sub-task using parentKey directly', () => { ... });
  it('does NOT set epicLink for Sub-tasks', () => { ... });
  it('adds Spike label for Spike type issues', () => { ... });
  it('always adds ai-generated label', () => { ... });
  it('maps Spike type to Story issuetype', () => { ... });
  it('sets story points custom field', () => { ... });
  it('sets sprint custom field when sprintId provided', () => { ... });
  it('includes acceptanceCriteria in description', () => { ... });
});
```

---

## Integration Tests

### Setup: Mock JIRA Server

Use `msw` (Mock Service Worker) or `nock` to intercept JIRA API calls.

```typescript
// src/__tests__/setup/mock-jira.ts

import nock from "nock";

export function mockJira(baseUrl = "http://localhost:8080") {
  return nock(baseUrl)
    .post("/rest/api/2/issue")
    .reply(201, (_, body) => ({
      id: "10001",
      key: `PROJ-${Math.floor(Math.random() * 1000)}`,
      self: `${baseUrl}/rest/api/2/issue/10001`,
      fields: body.fields,
    }));
}
```

### Tool Integration Tests (`src/__tests__/tools/`)

#### Draft Tools

```typescript
describe('commit_jira_draft', () => {
  it('refuses to commit unapproved draft', async () => {
    const draft = draftManager.create('PROJ', 'test', [mockEpic]);
    const result = await handleDraftTool('commit_jira_draft', { draft_id: draft.id });
    expect(result).toContain('Cannot commit');
  });

  it('commits epics before stories (order test)', async () => {
    const creationOrder: string[] = [];
    mockJiraCapture(creationOrder);
    // approve, then commit
    const result = await handleDraftTool('commit_jira_draft', { draft_id: ... });
    expect(creationOrder[0]).toBe('Epic');
    expect(creationOrder[1]).toBe('Story');
  });

  it('dry_run returns simulation without JIRA calls', async () => {
    const jiraCallCount = 0;
    mockJiraCount(jiraCallCount);
    // with dry_run: true — should NOT call JIRA
    expect(jiraCallCount).toBe(0);
    expect(result).toContain('DRY RUN');
  });

  it('sets committedKey on artifact after successful commit', async () => { ... });
  it('handles partial JIRA failures gracefully', async () => { ... });
  it('epic link resolution uses refToKey map', async () => { ... });
});
```

#### Issue Tools

```typescript
describe("jira_delete_issue", () => {
  it("refuses deletion without correct confirmation phrase", async () => {
    const result = await handleIssueTool("jira_delete_issue", {
      issue_key: "PROJ-1",
      confirmation_phrase: "delete",
    });
    expect(result).toContain("Deletion REFUSED");
  });

  it('deletes when phrase is exactly "DELETE CONFIRMED"', async () => {
    mockJiraDelete("PROJ-1");
    const result = await handleIssueTool("jira_delete_issue", {
      issue_key: "PROJ-1",
      confirmation_phrase: "DELETE CONFIRMED",
    });
    expect(result).toContain("permanently deleted");
  });
});
```

---

## End-to-End Tests

### E2E-01: Full Meeting → JIRA Workflow

**Precondition:** Docker JIRA stack running, PAT configured

1. Provide meeting notes to Claude
2. Verify `create_jira_draft` is called with correct artifact structure
3. Review the returned summary
4. Respond `APPROVE ALL`
5. Verify `approve_jira_draft` called
6. Verify `commit_jira_draft` called with `dry_run: false`
7. Check JIRA: Epics, Stories, and Bugs created with correct Epic Links
8. Verify `ai-generated` label on all issues

### E2E-02: Rejection and Revision Cycle

1. Create draft
2. Respond `REJECT — increase priority of all stories to High`
3. Verify revised draft is presented
4. Approve revised draft
5. Verify committed issues have updated priorities

### E2E-03: Partial Approval

1. Create draft with 5 artifacts
2. `APPROVE [EPIC-01, STORY-01]`
3. Verify only 2 issues created in JIRA
4. Remaining 3 artifacts stay in draft

### E2E-04: Sprint Planning Workflow

1. Create draft with sprint assignment
2. `APPROVE ALL` + commit
3. Verify `jira_move_to_sprint` called with correct issue keys
4. Verify issues appear in sprint board

---

## Security Tests

### SEC-01: PAT not exposed in logs

- Set `LOG_LEVEL=debug`
- Run any tool call
- `grep -i "JIRA_PAT\|Bearer" logs/jira-ai-mcp.log`
- Expected: no match (PAT must never appear in log output)

### SEC-02: Confirmation phrase cannot be bypassed

- Test `jira_delete_issue` with various inputs:
  - `"delete confirmed"` (lowercase) → REFUSED
  - `"DELETE CONFIRMED."` (trailing dot) → REFUSED
  - `""` (empty) → REFUSED
  - `"DELETE CONFIRMED"` (exact) → Proceeds

### SEC-03: Draft approval cannot be skipped

- Create a draft
- Call `commit_jira_draft` without calling `approve_jira_draft` first
- Expected: `Cannot commit — draft status is "pending_review"`

### SEC-04: .env.local not committed

- `git status` — `.env.local` should appear in `.gitignore` exclusions
- `git log --all --full-history -- .env.local` returns empty

### SEC-05: JQL injection (input validation)

- Attempt to pass JQL with embedded script injection to `jira_search_issues`
- Zod schema validates input type (string) — JIRA handles JQL safely server-side
- Verify no shell command execution occurs

---

## Running Tests

```bash
# Install dependencies
npm install

# Unit + integration tests
npm test

# With coverage
npm run test:coverage

# Watch mode (development)
npm run test:watch
```

---

## Test Data Fixtures

Location: `src/__tests__/fixtures/`

```
fixtures/
├── meeting-notes-auth.txt        # Example 1 meeting notes
├── meeting-notes-payments.txt    # Example 2 (payments module)
├── draft-artifacts-auth.json     # Expected artifact output for auth example
└── jira-responses/
    ├── create-issue.json         # Mock JIRA create response
    ├── get-board.json            # Mock board response
    └── search-results.json       # Mock JQL search response
```

---

## Coverage Requirements

| Module                     | Minimum Coverage       |
| -------------------------- | ---------------------- |
| `src/ai/draft-manager.ts`  | 95%                    |
| `src/tools/draft-tools.ts` | 85%                    |
| `src/tools/issue-tools.ts` | 80%                    |
| `src/jira/client.ts`       | 70% (integration only) |
| Overall                    | 80%                    |
