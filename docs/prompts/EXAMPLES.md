# Examples — Meeting Input → JIRA Draft Output

These examples show how Claude (with the system prompt) transforms raw meeting notes into structured JIRA artifacts.

---

## Example 1: Sprint Planning Meeting

### Input

```
We agreed to build the user authentication module this sprint.
It needs login, registration, and password reset.
The design team flagged a bug where the login button is misaligned on mobile.
We need to investigate whether OAuth 2.0 is feasible — assign to Dev to spike it.
Registration should have email verification.
Login and registration are high priority; password reset can be medium.
```

### Claude's `create_jira_draft` call

```json
{
  "meeting_context": "Sprint planning — User Authentication Module",
  "project_key": "PROJ",
  "artifacts": [
    {
      "ref": "EPIC-01",
      "type": "Epic",
      "summary": "User Authentication Module",
      "description": "Full authentication system covering login, registration, and password management.",
      "priority": "High",
      "storyPoints": 13,
      "acceptanceCriteria": [
        "Users can register with email and password",
        "Users can log in and receive a JWT session token",
        "Users can reset their password via email link",
        "All auth endpoints return appropriate error messages"
      ],
      "labels": ["authentication", "security"]
    },
    {
      "ref": "STORY-01",
      "type": "Story",
      "summary": "User Login — As a user, I want to log in with email and password so that I can access the application",
      "description": "Implement the login endpoint and UI form. Validate credentials against the user database, return JWT token on success.",
      "priority": "High",
      "storyPoints": 5,
      "epicRef": "EPIC-01",
      "acceptanceCriteria": [
        "Login form accepts email + password",
        "Invalid credentials show a clear error message",
        "Successful login redirects to dashboard",
        "JWT token stored in httpOnly cookie",
        "Rate limiting after 5 failed attempts"
      ],
      "labels": ["authentication"]
    },
    {
      "ref": "STORY-02",
      "type": "Story",
      "summary": "User Registration — As a user, I want to register with email verification so that my account is secure",
      "description": "Registration form with email verification flow. Send verification email on signup, activate account on link click.",
      "priority": "High",
      "storyPoints": 8,
      "epicRef": "EPIC-01",
      "acceptanceCriteria": [
        "Registration form collects email, password, confirm password",
        "Verification email sent within 60 seconds",
        "Account inactive until email verified",
        "Verification link expires after 24 hours",
        "Duplicate email shows appropriate error"
      ],
      "labels": ["authentication", "email"]
    },
    {
      "ref": "STORY-03",
      "type": "Story",
      "summary": "Password Reset — As a user, I want to reset my password via email so that I can regain access to my account",
      "description": "Forgot password flow with secure token-based email link.",
      "priority": "Medium",
      "storyPoints": 3,
      "epicRef": "EPIC-01",
      "acceptanceCriteria": [
        "Reset link sent to registered email",
        "Token expires after 1 hour",
        "Old password invalidated after reset",
        "Confirmation shown after successful reset"
      ],
      "labels": ["authentication"]
    },
    {
      "ref": "SPIKE-01",
      "type": "Spike",
      "summary": "Spike — Investigate OAuth 2.0 feasibility for social login",
      "description": "Time-boxed investigation: evaluate OAuth 2.0 providers (Google, GitHub), assess integration complexity, estimate story points for implementation.",
      "priority": "Medium",
      "storyPoints": 2,
      "epicRef": "EPIC-01",
      "notes": "Auto-assigned 2pts for spike. Assignee should be set via jira_assign_issue after commit.",
      "labels": ["spike", "oauth", "research"]
    },
    {
      "ref": "BUG-01",
      "type": "Bug",
      "summary": "Login button misaligned on mobile devices",
      "description": "Steps to reproduce:\n1. Open login page on mobile (< 768px width)\n2. Observe login button position\n\nExpected: Button full-width, centered\nActual: Button overflows or misaligns\n\nSeverity: Medium | Affects: All mobile users",
      "priority": "High",
      "storyPoints": 2,
      "epicRef": "EPIC-01",
      "labels": ["ui", "mobile", "bug"]
    }
  ]
}
```

### Returned Review Summary

```
═══════════════════════════════════════════════════════════════
JIRA DRAFT REVIEW SUMMARY
═══════════════════════════════════════════════════════════════
Draft ID  : 7f3a1c2d-...
Project   : PROJ
Status    : PENDING_REVIEW
Created   : 3/11/2026, 2:30:00 PM
Context   : Sprint planning — User Authentication Module

── EPICS (1) ──────────────────────────────────────────────────
  [EPIC-01] User Authentication Module
         Priority: High     | Points: 13
         Acceptance Criteria:
           • Users can register with email and password
           • Users can log in and receive a JWT session token
           • Users can reset their password via email link
           • All auth endpoints return appropriate error messages

── STORIES (3) ────────────────────────────────────────────────
  [STORY-01] User Login — As a user, I want to log in...
         Priority: High     | Points: 5
         Epic: EPIC-01

  [STORY-02] User Registration — As a user, I want to register...
         Priority: High     | Points: 8
         Epic: EPIC-01

  [STORY-03] Password Reset — As a user, I want to reset...
         Priority: Medium   | Points: 3
         Epic: EPIC-01

── BUGS (1) ───────────────────────────────────────────────────
  [BUG-01] Login button misaligned on mobile devices
         Priority: High     | Points: 2
         Epic: EPIC-01

── SPIKES (1) ─────────────────────────────────────────────────
  [SPIKE-01] Spike — Investigate OAuth 2.0 feasibility
         Priority: Medium   | Points: 2
         Epic: EPIC-01
         ℹ  Auto-assigned 2pts for spike. Assignee should be set after commit.

───────────────────────────────────────────────────────────────
TOTAL: 6 artifact(s) | 32 story points
───────────────────────────────────────────────────────────────
AWAITING YOUR DECISION:
  APPROVE ALL            → Commit all items to JIRA
  APPROVE [EPIC-01, ...] → Commit only the listed refs
  REJECT + <feedback>    → Revise and re-present draft
═══════════════════════════════════════════════════════════════
```

### User: `APPROVE ALL`

### Commit output

```
✅ [EPIC-01]  → PROJ-1  User Authentication Module
✅ [STORY-01] → PROJ-2  User Login — As a user...
✅ [STORY-02] → PROJ-3  User Registration — As a user...
✅ [STORY-03] → PROJ-4  Password Reset — As a user...
✅ [SPIKE-01] → PROJ-5  Spike — Investigate OAuth 2.0 feasibility
✅ [BUG-01]   → PROJ-6  Login button misaligned on mobile devices

Committed 6 / 6 issue(s) to JIRA.
```

---

## Example 2: Partial Approval

```
User: APPROVE [EPIC-01, STORY-01, STORY-02]

Claude: ✅ Draft approved (3 items).
        Call commit_jira_draft to push to JIRA.

[commits only those 3 items]
✅ [EPIC-01]  → PROJ-7  ...
✅ [STORY-01] → PROJ-8  ...
✅ [STORY-02] → PROJ-9  ...

Committed 3 / 3 issue(s) to JIRA.
```

---

## Example 3: Rejection with Feedback

```
User: REJECT — Password reset should be High priority not Medium,
      and the spike should have 3 story points not 2

Claude calls: reject_jira_draft(feedback="...")
              revise_jira_draft(artifacts=[... updated ...]

[Presents revised draft with corrected priorities and points]
```

---

## Example 4: Daily Standup Update

### Input

```
Standup notes:
- Alice: completed PROJ-2 (login form). Starting PROJ-3 today.
- Bob: PROJ-5 (OAuth spike) blocked — needs access to OAuth provider credentials
- Carol: PROJ-4 (password reset) still in progress, 50% done
```

### Claude's actions

1. `jira_get_transitions(PROJ-2)` → finds "Done" transition
2. `jira_transition_issue(PROJ-2, done_id)` → marks login done
3. `jira_transition_issue(PROJ-3, in_progress_id)` → starts registration
4. `jira_add_comment(PROJ-5, "BLOCKER: Dev needs OAuth provider credentials...")`
5. `jira_add_comment(PROJ-4, "Standup update: ~50% complete")`

No approval needed for status updates and comments.

---

## Example 5: Sprint Review Summary

### Claude generates via JQL searches:

```
Completed this sprint (jql: sprint in closedSprints() AND status = Done):
  PROJ-2 ✅ User Login (5pts)
  PROJ-6 ✅ Bug fix: mobile alignment (2pts)

Not completed (carried over):
  PROJ-3 ⏳ User Registration (8pts) — 60% done
  PROJ-4 ⏳ Password Reset (3pts) — In progress
  PROJ-5 🚫 OAuth Spike (2pts) — Blocked

Velocity: 7 pts completed / 20 pts planned (35%)
Carry-over: 13 pts

Risks:
  - OAuth spike blocked — needs stakeholder action
  - Registration story too large for 1 sprint — consider splitting
```
