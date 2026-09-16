# Phase 4 Spec — Semester Schedule

## Objective

Show ASC project deadlines and ordinary semester events in one member view without creating a second copy of assignment deadlines.

## Locked Rules

- `assignments.due_at` is the only source of truth for project deadlines.
- `events` stores only general ASC events such as seminar, CTF, meeting, presentation and other.
- Active members can read current-semester events; only active staff can create/update/delete them.
- Event links accept only HTTP/HTTPS.
- End time, if present, must be after start time.
- All member-facing date presentation uses Asia/Seoul.
- UI includes a compact upcoming list, monthly grid and full list; no recurring-event engine or external calendar integration is added.

## Acceptance Criteria

1. Member schedule combines active assignment deadlines with event rows and sorts them by time.
2. Project deadlines appear without duplicate event records.
3. Ordinary members cannot insert/update/delete events through PostgREST.
4. Staff can create events and members can read them.
5. Calendar/list/upcoming views statically build and remain usable on mobile.
