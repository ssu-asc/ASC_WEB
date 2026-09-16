# Phase 8 Context — Resource Hub & Link Management

## Why this phase exists

Phase 7 introduced a staff-only current-semester Google workspace configuration with four fixed Google URLs. The final operating model is broader:

- staff want one reference Google operations account for handover;
- staff want a generic link collection rather than four hard-coded Google fields;
- existing Notion study material should remain where it is and be discoverable by members through ASC_WEB;
- Drive, Docs, Sheets, Forms, GitHub, Discord, Notion, and other HTTPS resources should use one model;
- staff-only recruitment/operations resources must remain hidden from ordinary members;
- ASC_WEB should stay a link hub, not become a Notion clone or API synchronization service.

## Confirmed decisions

- Create a new `자료실` route for active semester members.
- Resource visibility has only two audiences: `member` and `staff`.
- Active staff may manage both audiences; ordinary members can discover only active `member` resources.
- Existing Notion study content is linked, not copied or mirrored.
- Store Google operations account email as non-secret handover metadata only.
- Do not store Google passwords, OAuth tokens, service-account keys, recovery codes, or API credentials.
- External service permissions remain authoritative. ASC_WEB only controls portal discovery.
- Public `/apply` remains static and separate from internal resource-link management.
- Phase 8 is a forward migration after deployed migrations 001–008.

## Delivery boundary

Phase 8 may apply a new production Supabase migration and redeploy the existing `operations-settings` Edge Function after all local tests pass. Public GitHub Pages deployment, actual external-resource permission setup, ProjectDB production write-token success testing, and git integration remain separate release decisions.

## Primary design

See `docs/superpowers/specs/2026-09-16-resource-hub-design.md`.
