# Phase 9 Progress — Staff Shared Secrets

## Status

**Implementation and hosted Supabase deployment complete.**

## Completed

- [x] migration 010 enables Supabase Vault and creates global staff memo, shared-secret metadata, audit tables and service-role-only Vault RPCs
- [x] existing non-secret Google handover metadata is preserved into the initial staff memo
- [x] browser roles receive no direct secret/audit/Vault/RPC access
- [x] dedicated `staff-secrets` Edge Function supports list/create/update/reveal/deactivate/reactivate/audit
- [x] `reveal` is no-store and the only plaintext-returning operation
- [x] Edge metadata responses strip internal Vault UUIDs
- [x] `operations-settings` now owns only staff memo + generic resource links; old Google-account runtime action removed
- [x] `/member/operations/settings` includes 운영진 메모, 링크 모음, 공용 계정 / 비밀정보, 최근 비밀정보 접근 기록
- [x] secret plaintext is masked by default, held in React state only, auto-cleared after 30 seconds, and cleared on hide/edit/deactivate/unmount/copy
- [x] local integration verifies stale secret updates do not mutate Vault values
- [x] local integration verifies inactive secrets cannot reveal and reactivation restores access
- [x] migration 010 applied to hosted Supabase
- [x] `staff-secrets` deployed ACTIVE v1
- [x] `operations-settings` redeployed ACTIVE v4
- [x] hosted CORS/reachability smoke includes `staff-secrets`
- [x] remote migration dry-run reports up to date

## Remaining release boundary

- public GitHub Pages deployment of the working tree
- entering real ASC shared credentials
- optional future step-up MFA/re-authentication before reveal
- ProjectDB production write-token success-path test
- full git integration of the current working tree
