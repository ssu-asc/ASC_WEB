# ASC 2026-2 Core Operations Portal

## Current State

**v1.0 shipped on 2026-09-17.** Phases 1–10 are implemented, integrated, deployed, and milestone-audited. Hosted Supabase is current through migration 011, all required Edge Functions are active, the production frontend is deployed through Cloudflare Pages project `asc-web` at `https://ssu-asc.com`, ProjectDB compatibility is merged, and a least-privilege server-side ProjectDB write token is provisioned. The first real staff approval is an operator smoke for the live GitHub write, not a remaining implementation dependency.

Milestone records:
- `.planning/v1.0-MILESTONE-AUDIT.md`
- `.planning/milestones/v1.0-ROADMAP.md`
- `.planning/milestones/v1.0-REQUIREMENTS.md`

### Next Milestone Goals

No feature milestone is currently committed. Candidate future work is limited to hardening/maintenance: step-up authentication before shared-secret reveal, token rotation/expiry tooling, production Auth-setting checks, and a deliberate framework-major upgrade when required. New product scope should begin as a new GSD milestone rather than extending v1.0 ad hoc.

## What This Is

기존 ASC 홈페이지 디자인을 그대로 두고 **회원관리, 개인·팀 프로젝트 제출, 제출 현황, 일정, 회원 자료실, 운영진 링크 관리**를 덧붙인다. 스터디 진행은 Discord에서 유지하고 기존 Notion/Drive/GitHub/Discord 자료는 ASC_WEB에서 링크로 발견할 수 있게 한다. 공개 회원가입, ASC_WEB 내부 Notion형 편집기, 회계, 자동 알림, 평가·순위, 별도 ATS/VPS는 만들지 않는다.

## Core Value

운영진은 학기별 활동회원 명단을 기준으로 누가 무엇을 제출하지 않았는지 확인하고, 부원은 같은 사이트에서 제출물과 마감일을 확인한다. GitHub와 사이트에 같은 보고서를 두 번 작성하지 않는다. 모집/면접 문서는 기존 외부 도구를 링크해 운영하고, 공용 계정 비밀번호/토큰이 필요한 경우에는 일반 테이블이 아니라 Supabase Vault를 통해서만 암호화 보관한다.

## Confirmed Decisions

- 공개 홈페이지의 영상, 글꼴, 색상, 콘텐츠, 기존 모집 수정사항을 보존한다. Header의 Member 링크만 의도적으로 추가한다.
- 회원 계정은 ASC 운영진이 발급한다. 부원은 자기 비밀번호를 변경하고 운영진은 회원관리에서 임시 비밀번호를 재발급할 수 있다.
- **Supabase Auth/Postgres**가 계정, 회원 프로필, 학기별 대상명단, 팀 구성, 제출·검토 상태, 일정, 운영진 메모, 학기별 외부 자료 링크를 관리한다. 공용 계정 비밀번호/토큰은 **Supabase Vault**에만 저장한다.
- **기존 ssu-asc/ProjectDB**가 개인·팀 Markdown 보고서와 Git 이력을 함께 보관한다. 실제 코드/PoC는 별도 프로젝트 저장소에 둘 수 있고 제출 화면에서는 그 GitHub 링크를 선택적으로 받는다.
- 팀은 학기 고정이며 운영진만 편성한다. 팀 프로젝트는 `(assignment_id, team_id)`당 하나의 공유 제출이고 팀원 중 한 명이 제출하면 팀 전체 제출로 본다.
- 로그인이나 계정 권한을 Git 저장소 파일로 구현하지 않는다. 회원 명단·학번·운영진 메모를 공개 저장소로 동기화하지 않는다.
- 프로젝트 제출기간은 assignments의 `opens_at`과 `due_at`을 원본으로 사용한다. 월간 달력은 프로젝트를 `due_at` 날짜의 마감으로 표시하고, 목록/상세는 전체 제출기간을 보여준다.
- 회원은 ProjectDB 경로/branch/tag/commit을 입력하지 않는다. `.md` 파일 본문만 업로드하고, 승인 시 서버가 신뢰 가능한 frontmatter와 개인/팀 ProjectDB 경로를 생성해 `report-01.md`로 게시한다.
- 제출 승인과 외부 공개는 다른 행위다. 승인이 자동으로 홈페이지 공개를 의미하지 않는다.
- 모집 지원은 기존 Google Forms/Sheets 흐름을 유지한다. 운영진은 Google/Instagram/GitHub 등 비밀이 아닌 인수인계 내용을 `운영진 메모`에 적고, Notion/Drive/Docs/Sheets/Forms/GitHub/Discord/기타 HTTPS 링크를 학기별로 관리한다.
- 각 링크는 `회원 공개` 또는 `운영진 전용`으로 분리한다. `/member/resources`는 회원 공개 자료만 보여주며 운영진 전용 링크는 운영진 설정에만 남긴다.
- 기존 Notion 스터디 자료는 옮기거나 복제하지 않고 링크로 재사용한다.
- Google 계정 변경은 Google 측 공유/소유권 이전으로 처리한다. 리소스를 복사해 URL이 바뀐 경우에만 ASC 운영진 설정에서 해당 링크를 바꾼다.
- OAuth/access token, 비밀번호 같은 공용 비밀정보를 보관해야 할 때는 일반 포털 테이블/브라우저 저장소에 평문으로 두지 않고 Vault-backed `공용 계정 / 비밀정보`에서만 관리한다. service-role key나 ProjectDB 운영키처럼 서버 자체 권한키는 여기에 넣지 않는다.
- Apps Script 자동화는 V1 범위 밖이다.

## Existing System Evidence

- ASC_WEB: Next.js 15.5.x/React 19, static export, CSS modules, GSAP, Pretendard/TheJamsil.
- 기존 공개 `/apply`는 `public/data/apply.json`의 Google Forms 링크를 사용한다.
- ProjectDB는 `reports/{year}/{quad}/{project}/report-NN.md`와 Git history를 실제 보고서 원본으로 사용하며 기존 Notion synchronization workflow를 유지한다.

## Architecture

Static ASC_WEB browser → Supabase Auth + RLS-protected operational tables.
Privileged account/team/assignment/settings/review management → authenticated Supabase Edge Functions.
Member Markdown draft → Supabase Postgres → staff approval → trusted server-side ProjectDB report generation/write.
External resources → semester-scoped `resource_links` with member/staff audience.
Staff handover memo → global `staff_private_settings`.
Shared organization credentials → metadata-only portal row + encrypted Supabase Vault secret, accessed only through `staff-secrets`.

Only publishable Supabase configuration may reach the browser. RLS and server-side role checks enforce authorization. No service-role, ProjectDB write token, Vault secret plaintext, or shared credential is embedded in browser configuration.

## Delivery Boundaries

Supabase production migrations/functions for the Member portal are operator-approved for deployment as implementation phases complete. Production static deployment uses the existing Cloudflare Pages project `asc-web` and custom domain `ssu-asc.com`; GitHub Pages is only a repository-side fallback and does not own the production custom domain. Git integration, production ProjectDB write-token success testing, and Google resource ownership/share administration remain separate release/operator actions.

No Outline/VPS/Docker service is required by the final architecture.

## Success Criteria

Issued member → login → 개인/팀 Markdown 파일 제출 → persistent state/schedule → member-visible resource hub. Staff → current roster → password reissue/team management/project rounds → reliable missing submissions → exact Markdown review → approval → ProjectDB 자동 게시 → 운영진 메모 + generic member/staff links + Vault-backed shared credentials. Public site remains unchanged apart from Member navigation. Completion claims require the current GSD phases and real authorization/DB/Edge smoke checks to pass.
