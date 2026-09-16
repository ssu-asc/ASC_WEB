# Markdown Upload → ProjectDB Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let members upload one Markdown report in ASC_WEB and publish approved individual/team reports automatically into the existing ProjectDB repository.

**Architecture:** Store pre-approval Markdown text directly in `submissions`, not object storage. Member writes remain authenticated through `submission-write`; staff approval in `submission-admin` generates trusted ProjectDB frontmatter/path and writes `report-01.md` through GitHub. ProjectDB gets backward-compatible validator/Notion-sync support for `source: asc_web` reports.

**Tech Stack:** Next.js 15.5, React 19, TypeScript 5, Supabase Auth/Postgres/Edge Functions, GitHub Contents API, Python 3.12/unittest, existing ProjectDB GitHub Actions/Notion sync.

**Spec:** `docs/superpowers/specs/2026-09-16-markdown-project-submission-design.md`

## Global Constraints

- No Supabase Storage, VPS, new GitHub report repository, or paid service.
- Required member file is one UTF-8 `.md`, max 262,144 bytes.
- Member Markdown must not contain leading YAML frontmatter; ASC_WEB generates trusted metadata.
- Member never supplies ProjectDB path/ref/branch/tag.
- Individual and team reports both publish to existing `ssu-asc/ProjectDB`.
- Existing team/legacy ProjectDB reports and historical ASC submissions remain backward compatible.
- One portal assignment maps to `report-01.md`; reapproval updates the same path.
- ProjectDB changes happen in an isolated ProjectDB feature worktree; do not edit ProjectDB `main` in place.
- Every shell command follows repository `rtk` requirements.

---

### Task 1: Add Markdown draft persistence and validation

**Files:**
- Create: `supabase/migrations/202609160011_markdown_submission.sql`
- Create: `src/lib/submission-upload.ts`
- Modify: `src/lib/member-domain.ts`
- Modify: `src/lib/member-api.ts`
- Modify: `tests/member-contract.test.mjs`
- Modify: `tests/member-domain.test.mjs`
- Modify: `tests/live-supabase.mjs`

**Interfaces:**
- Produces `validateMarkdownUpload(filename: string, markdown: string)` for browser-side validation.
- Extends submission data with `report_filename`, `report_markdown`, `report_bytes`.
- Publication fields become nullable for draft submissions.

- [ ] Write failing static/domain tests that require migration 011, nullable legacy publication fields, Markdown draft fields, `.md`/size/frontmatter validation, and no Storage dependency.
- [ ] Run targeted tests and verify RED because migration/helper do not exist.
- [ ] Add migration 011 with draft columns, safe checks, and nullable `report_repository_url/report_path/submitted_ref`.
- [ ] Add pure browser validation helper: `.md`, safe basename, non-empty, no NUL, no leading `---`, UTF-8 bytes <=262144.
- [ ] Extend submission types/select field constants for nullable publication fields + Markdown draft fields.
- [ ] Run unit/type tests and local Supabase reset; verify GREEN.

### Task 2: Replace member ProjectDB path/ref form with Markdown upload

**Files:**
- Modify: `src/app/member/submission/page.tsx`
- Modify: `src/lib/member-api.ts`
- Modify: `supabase/functions/submission-write/index.ts`
- Modify: `tests/member-contract.test.mjs`
- Modify: `tests/live-supabase.mjs`

**Interfaces:**
- `saveSubmission` accepts `assignment_id`, `summary`, optional `code_repository_url`, `report_filename`, `report_markdown`, optional `expected_version`.
- Server derives title/owner/team and encoded byte count.

- [ ] Write failing contract/integration tests asserting `type="file"`, `.md` acceptance, removal of ProjectDB path/ref inputs, and server Markdown validation.
- [ ] Verify RED against the current path/ref form.
- [ ] Rewrite the member submission page: read `File.text()`, validate, show filename/byte size, optional GitHub repo, summary, and submit/revision actions.
- [ ] Rewrite `submission-write` body contract and authoritative validation. Set title from assignment; keep pre-open/late/team/stale/approved rules.
- [ ] On a revised draft, clear stale `report_repository_url`, `report_path`, `submitted_ref`, and ProjectDB sync fields.
- [ ] Run unit/type/build and local Supabase integration; verify GREEN.

### Task 3: Generalize ProjectDB validator and Notion sync backward-compatibly

**Files in isolated ProjectDB worktree:**
- Modify: `scripts/validate_frontmatter.py`
- Modify: `scripts/sync_notion.py`
- Modify: `tests/test_sync_notion.py`
- Create: `tests/test_validate_frontmatter.py`
- Modify: `README.md`

**Interfaces:**
- Legacy reports keep current required fields/validation.
- `source: asc_web` requires `project_type` + trusted core metadata, while `cl_level` and `contributions` are optional.
- Notion property builder omits absent CL/contributions and skips individual tracking.

- [ ] Create a native DevSpace ProjectDB worktree from `main` on a feature branch and run existing unittest baseline.
- [ ] Write failing tests for portal individual/team fixtures, legacy compatibility, malformed portal metadata, omitted CL/contributions, and individual tracking skip.
- [ ] Verify RED with current validator/sync implementation.
- [ ] Implement source-aware validation without changing legacy rules.
- [ ] Modify Notion property building so missing CL is omitted rather than defaulted to CL1; keep contribution behavior conditional.
- [ ] Skip tracking checkbox update for `project_type == "individual"`.
- [ ] Document portal-generated reports and `quad_name: 개인` in README.
- [ ] Run `python -m unittest discover -s tests -v` and validator fixture checks; verify GREEN.

### Task 4: Generate deterministic ProjectDB reports and publish on approval

**Files:**
- Create: `supabase/functions/_shared/projectdb-report.ts`
- Modify: `supabase/functions/submission-admin/index.ts`
- Modify: `tests/member-contract.test.mjs`
- Create or modify: `tests/projectdb-report.test.mjs`
- Modify: `tests/live-supabase.mjs`

**Interfaces:**
- Pure `buildProjectDbReport(input)` returns `{ path, markdown }`.
- `submission-admin` publishes Markdown-backed rows to ProjectDB and persists returned commit SHA/path/repository URL.
- Legacy rows with null `report_markdown` retain old supplemental archive sync.

- [ ] Write failing pure tests for individual/team deterministic path generation, safe Unicode path segments, trusted frontmatter, member lists, and body preservation.
- [ ] Verify RED because builder does not exist.
- [ ] Implement pure report builder with server-controlled frontmatter and traversal-safe path segments.
- [ ] Add `submission-admin` data loading for assignment + owner/team profiles needed by the builder.
- [ ] For Markdown rows, GET target ProjectDB file, PUT create/update `report-01.md`, read commit SHA, and persist publication fields only after successful GitHub write.
- [ ] Keep approval durable when publish fails and preserve retry behavior.
- [ ] Keep legacy sidecar sync branch for historical rows without Markdown.
- [ ] Run pure tests + local integration; verify GREEN.

### Task 5: Add exact Markdown draft inspection to staff review

**Files:**
- Modify: `src/app/member/operations/submissions/page.tsx`
- Modify: `src/lib/member-api.ts`
- Modify: `tests/member-contract.test.mjs`
- Modify: `tests/member-browser.mjs` only if route checks need adjustment.

**Interfaces:**
- Staff overview submission rows expose filename/bytes/Markdown draft fields.
- Staff preview renders escaped text, never raw HTML.

- [ ] Write failing contract tests for filename/byte/body preview and absence of iframe/raw HTML injection.
- [ ] Verify RED.
- [ ] Extend staff overview query/types to load Markdown draft metadata/body.
- [ ] Render filename/size and escaped Markdown in a review detail block; keep code repo, review note, approve/revision/retry controls.
- [ ] After successful sync, render immutable ProjectDB link using saved path + commit SHA.
- [ ] Run unit/type/build/browser smoke; verify GREEN.

### Task 6: Update GSD/docs and deploy Supabase Phase 10

**Files:**
- Modify: `.planning/PROJECT.md`
- Modify: `.planning/REQUIREMENTS.md`
- Modify: `.planning/ROADMAP.md`
- Modify: `.planning/STATE.md`
- Create: `.planning/phases/10-markdown-project-submission/10-PLAN.md`
- Create: `.planning/phases/10-markdown-project-submission/10-PROGRESS.md`
- Create: `.planning/phases/10-markdown-project-submission/10-SUMMARY.md`
- Create: `.planning/phases/10-markdown-project-submission/10-VERIFICATION.md`
- Modify: `docs/member-portal-setup.md`
- Modify: `tests/live-edge-smoke.mjs` only if changed function coverage needs expansion.

**Interfaces:**
- Deployment updates `submission-write` and `submission-admin` after migration 011.
- ProjectDB production publication is not claimed successful unless a controlled real-token test is explicitly run.

- [ ] Update authoritative docs from path/ref submission to Markdown upload → approval → ProjectDB publish.
- [ ] Run full ASC_WEB gate: `npm test`, typecheck, build, browser, local integration, hosted edge smoke, diff check.
- [ ] Run ProjectDB full unittest/validator gate in isolated worktree.
- [ ] Run remote `supabase db push --dry-run`; require only migration 011 pending.
- [ ] Apply migration 011.
- [ ] Deploy `submission-write` and `submission-admin` with the established deployment path.
- [ ] Verify hosted function status/CORS and final remote dry-run reports up to date.
- [ ] Record exact evidence and remaining release boundaries; do not claim GitHub Pages or real ProjectDB-token publish is live unless separately executed.

## Self-review

- Spec coverage: member UX, DB compatibility, individual/team ProjectDB paths, legacy submissions, ProjectDB validator, Notion sync, review UX, security, free-cost constraint, deployment all have tasks.
- Placeholder scan: no TBD/TODO/future implementation placeholders are used as plan steps.
- Type consistency: member draft uses `report_filename/report_markdown`; publication uses existing nullable `report_repository_url/report_path/submitted_ref`; ProjectDB builder returns `path/markdown`.
- Scope: one coherent submission pipeline; PDF/assets/repository creation remain explicitly out of scope.
