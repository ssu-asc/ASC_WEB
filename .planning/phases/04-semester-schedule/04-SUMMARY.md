# Phase 4 Summary — Semester Schedule

## Delivered

- `/member/schedule` shows upcoming items, a monthly grid and a full list.
- Assignment deadlines are synthesized directly from `assignments.due_at`.
- General semester events live in `events` with categories for seminar, CTF, meeting, presentation and other.
- Active members read current-semester events; RLS restricts create/update/delete to active staff.
- Staff can add/edit/delete general events from the member area.
- All date formatting and `datetime-local` conversion is handled in Asia/Seoul.
- Mobile calendar uses compact markers while full event detail remains available in the list.

## Evidence

Domain tests verified merge/validation behavior. Local Supabase integration verified ordinary-member event writes are denied, staff event writes succeed, and the resulting event is visible to the member.
