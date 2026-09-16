# Phase 10 Plan — Markdown Upload → ProjectDB Publish

1. Add migration 011 and Markdown upload validation/persistence.
2. Replace member ProjectDB path/ref form with required `.md` upload + optional code repo.
3. In isolated ProjectDB worktree, generalize validator/Notion sync for `source: asc_web` individual/team reports while preserving legacy behavior.
4. Add pure deterministic ProjectDB report builder and publish Markdown-backed submissions on approval; preserve legacy sidecar sync for historical rows.
5. Add exact escaped Markdown draft inspection to staff review.
6. Update GSD/operator docs, run full ASC_WEB + ProjectDB gates, dry-run migration 011, apply/deploy changed Edge Functions, and verify hosted reachability.

Full executable plan: `docs/superpowers/plans/2026-09-16-markdown-project-submission.md`.
