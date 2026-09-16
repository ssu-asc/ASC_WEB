# Phase 2 Summary — Git Project Submissions

## Delivered

- Member dashboard links individual/team requirements to `/member/submission`.
- Submission form stores project title/summary, optional code repository, report repository, Markdown path and pinned commit/tag.
- `submission-write` Edge Function authenticates the caller and validates current-semester eligibility.
- Initial team submission can create one confirmed team from 2–12 eligible active members; confirmed membership is reused on later submissions.
- Approved submissions are read-only to ordinary members until staff reopens them.
- Team members share the same team submission state.
- Existing ProjectDB `reports/` files and Notion workflow were not modified.

## Evidence

- `npm test`: domain/contract coverage includes unsafe Markdown path rejection, team-vs-submission distinction and approved-write rules.
- `npm run test:integration`: actual local Supabase Auth/RLS/Edge Function flow verified individual isolation, team submission creation, teammate visibility and approved overwrite rejection.
- TypeScript, static Next export and Chromium fail-closed routes were verified in the milestone verification run.

## Deferred Operational Check

A production GitHub/ProjectDB credential is intentionally not embedded or exercised locally. ProjectDB success-path verification is a deployment/operator check; failure-path durability is covered by Phase 3 integration tests.
