# Phase 3 Spec — Staff Review

## Objective

Give ASC staff one semester-wide view derived from the active roster, not from only the submissions that happen to exist, and allow staff to review a concrete submitted Git version.

## Locked Rules

- `semester_memberships` is the denominator for submission tracking.
- `not_submitted`, `not_assigned`, `submitted`, `revision_requested`, `approved`, and `not_required` are distinct states.
- Inactive members and waived requirements are excluded from required counts.
- Ordinary members cannot approve/reject via direct PostgREST or Edge Function calls.
- Staff review notes are visible to the affected member/team.
- Approval writes `approved` to Supabase first; ProjectDB synchronization is secondary.
- ProjectDB sync failure records `failed` and an error without rolling back approval.
- A failed ProjectDB sync can be retried from the staff view.
- Portal archive records contain project metadata only; operational review notes do not go to ProjectDB.

## Acceptance Criteria

1. Staff can filter by individual/team and review state and search member/team/project text.
2. Missing individual, team-unassigned and team-assigned-but-not-submitted are distinguishable.
3. Staff can request revision or approve with an optional note.
4. Member APIs/RLS cannot directly set an approval state.
5. Approval persists if ProjectDB has no credential or GitHub returns an error.
6. Staff can retry a failed ProjectDB sync.
7. ProjectDB integration targets `portal-index/{semester}/{project_type}/{submission_id}.json` without touching existing `reports/` files.
