# Phase 1 Context

## User-approved boundary

2026-2 회원관리, 개인·팀 프로젝트 제출, 현황, 일정만. 기존 디자인 그대로 덧붙인다. Supabase는 회원/운영 DB로 유지하고 ProjectDB는 기존 보고서 저장소를 재사용한다. 사용자는 GSD 정리 후 구현 시작을 승인했다.

## Decisions

- D-01: Static export 유지. 브라우저는 Supabase publishable key만 사용한다.
- D-02: 현재 체크아웃에서 단일 작성자로 작업. 기존 커밋 175b7d3 및 모집 수정 보존. commit/push/deploy/원격 migration은 하지 않는다.
- D-03: Phase 1은 실제 읽기 tracer부터 구현하고 서버 계정관리는 다음 task로 분리한다. UI 준비를 전체 회원관리 완료로 표시하지 않는다.
- D-04: profiles는 계정 상태/권한, semester_memberships는 학기별 제출 대상을 관리한다. 팀 배정과 제출은 별개다.
- D-05: due_at이 정해지지 않았으면 '마감 미정'. 연결 설정이 없으면 '연결 설정 필요'. API 오류는 미제출로 바꾸지 않는다.
- D-06: 기존 ProjectDB는 실제 Markdown 보고서 저장소다. 보고서 저장소와 코드 저장소를 분리해 참조할 수 있게 한다. 기존 Notion workflow는 아직 건드리지 않는다.
- D-07: 일정은 Phase 4. 로그인/명단/프로젝트 UI에 가짜 일정이나 미구현 동작 성공 메시지를 넣지 않는다.

## Evidence

- npm run build: 변경 전 Next.js 15.5.12 정적 빌드 성공, 기존 공개 경로 7개.
- .env* files: 프로젝트 루트에서 발견되지 않음. 실제 Supabase 프로젝트 연결은 미확인.
- ../ProjectDB/README.md, templates/report-template.md: PR → 검토/merge → Notion 동기화, reports/{year}/{quad}/{project}/report-NN.md.
- GSD runtime-identity: @opengsd/gsd-core 1.13.0.
- Runtime directory: /home/yc54616/.npm/_npx/ffb6f4419cab88dd/node_modules/@opengsd/gsd-core. 원래 스킬이 참조하는 ~/.claude/gsd-core에는 실행 파일이 없음. 전역 설치는 변경하지 않음.

## Verification limits

Separate Codex planner invocation was blocked by tool safety checks; no worker started. Do not claim independent planner/checker approval. Official CLI structural validation and local implementation checks are separate evidence. Independent review and real Supabase authorization tests remain release blockers.
