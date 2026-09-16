# Phase 8 Plan — Resource Hub & Link Management

## Goal

Generalize fixed Google operations links into a semester-scoped account reference + reusable resource link collection, and add a member-facing resource hub for existing Notion/Drive/GitHub/Discord study material.

## Tasks

1. **Migration 009 / RLS**
   - add `staff_workspace_settings.google_account_email`;
   - create `resource_links` with service/category/audience/version fields;
   - migrate migration-008 fixed Google links into staff-only rows;
   - ordinary members can read only active `audience='member'` links for semesters they can access;
   - browser writes remain denied.

2. **`operations-settings` generic API**
   - `save_metadata`;
   - `create_link`;
   - `update_link`;
   - `deactivate_link`;
   - `reorder_links`;
   - optimistic conflict checks and HTTPS/email validation.

3. **Staff link manager**
   - Google operations account reference field;
   - generic add/edit/delete/reorder UI;
   - service/category/audience native selects;
   - staff-only resources remain here.

4. **Member resource hub**
   - `/member/resources`;
   - active member-visible links only;
   - filters: 전체/스터디/프로젝트/CTF/기타;
   - no iframe/content synchronization;
   - `자료실` navigation for members and staff;
   - remove toolbar Drive lookup/special shortcut.

5. **Verification/deployment**
   - update docs/GSD state;
   - unit/type/build/browser/local Supabase/hosted Edge/diff checks;
   - dry-run must show only migration 009 before apply;
   - apply migration 009;
   - deploy `operations-settings --use-api`;
   - final remote dry-run up to date.

## Detailed plan

`docs/superpowers/plans/2026-09-16-resource-hub.md`
