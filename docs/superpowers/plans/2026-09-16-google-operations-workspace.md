# Google Operations Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the optional self-hosted Outline integration with a zero-cost, staff-managed Google Forms/Sheets/Drive/Docs workspace whose links can be changed without redeploying ASC_WEB.

**Architecture:** Store only non-secret Google resource URLs in Supabase, scoped to the current semester. Staff read them through staff-only RLS and update them through an authenticated `operations-settings` Edge Function with optimistic version checks. ASC_WEB never stores Google OAuth tokens or passwords; Google ownership/account transfer remains an external Google operation, and changing copied resource URLs only requires editing the staff settings page.

**Tech Stack:** Next.js 15.5.x, React 19, TypeScript 5, Supabase Postgres/RLS/Edge Functions, Google Forms/Sheets/Drive/Docs external links.

**Spec:** `.planning/phases/07-final-operations-polish/07-SPEC.md`

## Global Constraints

- Keep GitHub Pages + Supabase Free compatible; do not require a VPS or Docker service.
- Do not add Google OAuth, service-account keys, access tokens, refresh tokens, or Google credentials to ASC_WEB.
- Store only HTTPS Google resource links: Form, candidate Sheet, operations Drive, interview template Doc.
- Settings are staff-only and current-semester scoped.
- Browser writes remain behind an authenticated Edge Function; staff role is re-checked server-side.
- Existing public `/apply` static configuration is not silently rewritten by this staff workspace setting.
- Existing team submission behavior remains one submission per `(assignment_id, team_id)` and is not changed.
- All repository shell commands begin with `rtk`.

---

### Task 1: Add current-semester Google operations settings storage

**Files:**
- Create: `supabase/migrations/202609160008_google_operations_settings.sql`
- Create: `supabase/functions/operations-settings/index.ts`
- Modify: `supabase/config.toml`
- Modify: `src/lib/member-api.ts`
- Test: `tests/member-contract.test.mjs`
- Test: `tests/live-supabase.mjs`

**Interfaces:**
- Produce table `staff_workspace_settings(semester, form_url, candidate_sheet_url, operations_drive_url, interview_template_url, version, updated_by, updated_at)`.
- Produce `readStaffWorkspaceSettings(client, profile)` and `saveStaffWorkspaceSettings(client, input)`.
- Produce Edge Function `operations-settings` action `save`.

- [ ] **Step 1: Add failing contract/integration tests**

Assert migration enables RLS, authenticated users receive select only, staff-only read policy exists, Edge Function uses `requireStaff(req)`, and ordinary members cannot read/update settings. Integration creates current-semester settings, rejects stale version, and accepts only the documented Google URL families.

- [ ] **Step 2: Run focused tests and confirm RED**

Run `rtk npm test -- --test-name-pattern="Google operations settings|operations-settings"` and expect failure because migration/function/API do not exist.

- [ ] **Step 3: Implement migration 008**

Create one settings row per semester with nullable URL fields and `version bigint not null default 1`. Enable RLS; authenticated receives SELECT only; policy permits select only when `private.is_active_staff()` is true. `service_role` keeps full access. Do not expose the settings to normal members.

- [ ] **Step 4: Implement `operations-settings` Edge Function**

Validate current semester server-side. URL rules:
- Form: empty/null, `https://docs.google.com/forms/...`, or `https://forms.gle/...`
- Sheet: empty/null or `https://docs.google.com/spreadsheets/...`
- Drive: empty/null or `https://drive.google.com/...`
- Template: empty/null or `https://docs.google.com/document/...`

For first save require `expected_version=0` and insert version 1. For existing settings require exact current `expected_version`, update with `version + 1`, and return 409 on stale writes. Set `updated_by` to the authenticated staff profile ID.

- [ ] **Step 5: Add client APIs**

Add `StaffWorkspaceSettings`, `StaffWorkspaceSettingsDraft`, `readStaffWorkspaceSettings`, and `saveStaffWorkspaceSettings`. Reading first resolves current semester and then selects the staff-only settings row.

- [ ] **Step 6: Run unit/type/local integration tests**

Run `rtk npm test`, `rtk npm run typecheck`, and `rtk npm run test:integration`; all must pass.

---

### Task 2: Add staff settings UI and dynamic operations link

**Files:**
- Create: `src/app/member/operations/settings/page.tsx`
- Modify: `src/component/member/MemberToolbar.tsx`
- Modify: `src/styles/member.module.css`
- Modify: `tests/member-browser.mjs`
- Test: `tests/member-contract.test.mjs`

**Interfaces:**
- Staff settings route edits the four Google links and explains that ownership/account changes happen in Google, while ASC stores only URLs.
- Staff toolbar shows `운영진 설정`; if `operations_drive_url` is configured, it also shows `면접 / 운영 문서 ↗` opening the Drive URL.
- Ordinary members never receive these links.

- [ ] **Step 1: Add failing source/browser checks**

Require `/member/operations/settings`, the four field labels, `운영진 설정`, and dynamic `면접 / 운영 문서 ↗`. Assert toolbar no longer uses `NEXT_PUBLIC_ASC_OPS_URL`.

- [ ] **Step 2: Run focused checks and confirm RED**

Run `rtk npm test -- --test-name-pattern="Google workspace settings UI|operations workspace"` and expect failure.

- [ ] **Step 3: Implement settings page**

Use `MemberGate staffOnly`. Load current settings, edit locally, save explicitly with optimistic version, and provide safe external links for configured resources. Include an account handover note covering Form, response Sheet, Drive folder, template Doc, and Apps Script trigger recreation if automation is ever added.

- [ ] **Step 4: Implement toolbar link**

For staff only, load current settings after session is ready. Always show `운영진 설정`; show `면접 / 운영 문서 ↗` only when a Drive URL is configured. Use `target="_blank" rel="noopener noreferrer"`.

- [ ] **Step 5: Add responsive styles and browser route smoke**

Keep existing dark Member design and add the new settings route to fail-closed Chromium smoke coverage.

- [ ] **Step 6: Verify**

Run `rtk npm test`, `rtk npm run typecheck`, `rtk npm run build`, and `rtk npm run test:browser`.

---

### Task 3: Remove Outline from the release architecture and finish deployment

**Files:**
- Modify: `.gitignore`
- Modify: `.env.example`
- Modify: `.github/workflows/deploy-pages.yml`
- Modify: `.planning/PROJECT.md`
- Modify: `.planning/REQUIREMENTS.md`
- Modify: `.planning/ROADMAP.md`
- Modify: `.planning/STATE.md`
- Modify: `.planning/phases/07-final-operations-polish/07-SPEC.md`
- Modify: `.planning/phases/07-final-operations-polish/07-PLAN.md`
- Modify: `.planning/phases/07-final-operations-polish/07-CONTEXT.md`
- Modify: `docs/member-portal-setup.md`
- Test: `tests/member-contract.test.mjs`

**Interfaces:**
- Outline is no longer a release dependency.
- `NEXT_PUBLIC_ASC_OPS_URL` is removed from runtime/build configuration.
- `ops/outline/` is ignored as obsolete local scratch and is not part of the release.
- Google workspace resources are configured at runtime by staff through Supabase.

- [ ] **Step 1: Add failing contract assertions for the zero-cost architecture**

Assert no runtime source/workflow/env example references `NEXT_PUBLIC_ASC_OPS_URL`, GSD requirements describe Google resources rather than Outline, and `.gitignore` excludes `/ops/outline/`.

- [ ] **Step 2: Update docs/GSD/config**

Remove the Pages build variable and `.env.example` Outline URL. Replace Outline instructions with Google account handover/share instructions and state that Apps Script is optional and not implemented in V1.

- [ ] **Step 3: Run final gates**

Run `rtk npm test`, `rtk npm run typecheck`, `rtk npm run build`, `rtk npm run test:browser`, `rtk npm run test:integration`, `rtk npm run test:edge`, and `rtk git diff --check`.

- [ ] **Step 4: Deploy backend changes**

Run `rtk npx supabase db push --dry-run`; verify only migration `202609160008_google_operations_settings.sql` is pending. Apply it, deploy `operations-settings`, and re-deploy any shared-code-dependent functions only if needed. Verify the new function appears ACTIVE.
