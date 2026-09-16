# ASC_WEB Onboarding Summary

Updated 2026-09-15. See .planning/STATE.md for current implementation progress; this onboarding note is not a completed phase summary.

## Verified Context

- Existing checkout: /home/yc54616/Desktop/ASC/2026/ASC_WEB.
- Branch: fix/hof-recruit-2026-2; existing HEAD 175b7d3 preserved.
- Next.js 15.5.12 static export, React 19, GSAP, CSS modules, existing local fonts.
- Source read: package.json, next.config.ts, src/app/{page,layout,header}.tsx, globals.css, ui/page CSS, public/data/projects.json.
- Baseline static build passed before implementation.
- ../ProjectDB/README.md and templates/report-template.md confirm actual Markdown report files, frontmatter and PR-to-Notion sync. ProjectDB was not modified.

## Scope

Supabase account/member/semester operations + Git/ProjectDB reports + submission review + schedule. No Notion editor, study system, finance, recruitment, notifications or public redesign.

## Implementation Handoff

Phase 1 initial login/read tracer exists. Account mutations, live Supabase verification, independent review and subsequent phases are not complete. Continue the existing 01-PLAN.md rather than recreating planning files or resetting the repository.
