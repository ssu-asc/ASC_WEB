# Phase 2 Spec — Git Project Submissions

## Objective

Allow an active 2026-2 member to submit either an individual project or one shared confirmed-team project without uploading duplicate PDF files. The reviewed artifact is a GitHub repository, a Markdown path inside that repository, and a pinned review ref.

## Locked Rules

- Git remains the source of truth for code and report content.
- A submission records ProjectDB `report_repository_url`, `report_path`, immutable full commit SHA in `submitted_ref`, optional code repository, title and summary. User input branch/tag/commit is resolved server-side before persistence.
- Reports are Markdown; PDF upload is outside this milestone.
- Individual submissions belong to the authenticated member only.
- A team is formed from active current-semester members and is not equivalent to a completed submission.
- Initial team creation requires 2–12 members including the caller; a member may have one confirmed team per semester.
- Once a team exists, ordinary members cannot silently change its membership from the submission form.
- An approved submission is immutable to members until staff changes it to `revision_requested`; optimistic `version` checks also prevent stale member/staff writes racing with each other.
- ProjectDB's existing `reports/{year}/.../report-NN.md` Markdown/Notion workflow is preserved. The trusted submission function verifies the real Markdown file at the resolved SHA. Portal approvals write separate privacy-minimized `portal-index/...json` archive metadata.
- ProjectDB/GitHub write failure must never erase the Supabase submission or reverse an approval.

## Acceptance Criteria

1. Individual and team forms persist repository/report/ref metadata through the trusted `submission-write` Edge Function.
2. The browser cannot directly insert/update `submissions`, `teams`, or `team_members` with its publishable key.
3. Another ordinary member cannot read an individual submission.
4. Confirmed teammates read the same team submission and review state.
5. Invalid Markdown traversal paths, non-ProjectDB report repositories, paths outside `reports/{year}/.../report-NN.md`, and missing refs/files are rejected before persistence.
6. The stored report ref is a verified 40-character commit SHA even when the user submits a branch/tag.
7. Approved submissions and stale-version member/staff writes return conflict instead of overwriting newer state.
8. Initial team creation + membership + first submission commit atomically.
9. Existing ProjectDB report source files are not modified by this phase.
