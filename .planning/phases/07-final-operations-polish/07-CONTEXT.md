# Phase 7 Context — Final Operations Polish

## Why this phase exists

After the core portal and operations redesign were implemented, final real-operator feedback exposed four finishing requirements:

1. spreadsheet member management must still provide per-member password reissue;
2. month calendar should emphasise project deadlines instead of visually occupying the whole submission window;
3. interview/operations collaboration must remain zero-cost and must not require a separate self-hosted service;
4. staff must be able to change Google resource links when the owning/editing Google account or copied resource changes.

## Confirmed decisions

- Existing password reset capability is restored as `임시 비밀번호 재발급` from the member spreadsheet.
- Team project semantics remain unchanged: one submission per fixed semester team, and any teammate may submit/update it.
- `opens_at` and `due_at` remain the project timing source of truth.
- Upcoming/list/detail schedule views show the full project window; month calendar places projects on `due_at` only.
- The previous optional Outline direction is superseded.
- Staff collaboration uses external Google Forms/Sheets/Drive/Docs only; ASC_WEB stores URLs, not Google credentials.
- Staff can edit the current semester's four Google URLs in `/member/operations/settings` without rebuilding the static site.
- Google account handover happens inside Google permissions/ownership. ASC settings change only if a copied/recreated resource receives a new URL.
- Apps Script is not implemented in V1. If added later, installable triggers must be recreated under the intended execution account during handover.

## Cost boundary

The intended stack remains compatible with zero direct infrastructure cost:

- GitHub Pages for the public/static frontend;
- Supabase Free tier for Auth/Postgres/Edge Functions within quota;
- Google Forms/Sheets/Docs/Drive using the club/operator Google account within free storage/service limits.

No VPS, Docker server, Outline, Notion clone, ATS server, or Google OAuth backend is required by this phase.

## Deployment boundary

Phase 7 adds production migration `202609160008_google_operations_settings.sql` and Edge Function `operations-settings`. Existing Supabase project linkage is reused. Public GitHub Pages deployment, ProjectDB write-token success testing, and git commit/push remain separate release/integration choices.
