# ASC 2026-2 Member Portal — 운영·배포 안내

## 현재 구현 범위

기존 ASC 공개 홈페이지의 정적 export와 시각 언어는 유지하면서 내부 Member 영역을 운영 포털로 확장한다.

### 부원

- `/member/login` — ASC가 발급한 아이디/비밀번호 로그인
- `/member` — `지금 할 프로젝트 / 다음 프로젝트 / 지난 프로젝트`
- `/member/submission` — `.md` 보고서 파일 업로드 및 재제출; 승인 후 ProjectDB 자동 게시
- `/member/schedule` — 프로젝트 제출기간 + ASC 일반 일정
- `/member/resources` — 회원 공개 스터디/프로젝트/CTF/공용 링크 자료실
- `/member/password` — 본인 비밀번호 변경

### 운영진

- `/member/operations/progress` — 부원별 개인/팀 프로젝트 전체 진행현황
- `/member/operations/submissions` — 회차별 프로젝트 상세 현황/검토
- `/member/operations/teams` — 학기 팀 편성·이름/구성 수정
- `/member/operations/members` — 간소화된 스프레드시트형 회원관리 + 회원별 임시 비밀번호 초기화
- `/member/operations/settings` — 운영진 메모 + 회원/운영진 링크 모음 + Vault 기반 공용 계정/비밀정보 관리
- `/member/resources` — 운영진도 회원 공개 자료를 동일하게 확인
- `/member/schedule` — 일반 일정 및 프로젝트 회차 생성/수정
- `/member/password` — 본인 비밀번호 변경

스터디 진행 자체는 Discord에 유지한다. 기존 Notion 스터디 페이지, Drive 자료, GitHub 저장소, Discord 링크 등은 내용을 옮기지 않고 `/member/resources`에 링크로 등록한다. 회계, ASC_WEB 내부 모집/ATS, 일반 태스크 관리, 점수/랭킹, 내장 Notion 대체는 범위가 아니다. 별도 Outline/VPS/Docker 서버도 필요 없다.

## 핵심 운영 모델

### 운영진은 프로젝트 제출자가 아니다

일반적인 운영진 계정은 `individual_required=false`, `team_required=false`로 관리한다. 부원 계정은 둘 다 `true`가 기본이다. 호환성을 위해 DB 필드는 유지하지만 일반 회원관리 UI에서는 역할을 기준으로 서버가 자동 결정한다.

### 팀은 학기 단위로 관리한다

팀은 운영진이 `/member/operations/teams`에서 편성하고 필요할 때 이름과 구성을 수정한다.

- 부원은 제출 화면에서 팀을 만들거나 바꿀 수 없다.
- 한 부원은 학기당 최대 한 팀에만 속한다.
- 운영진은 팀 카드에서 이름 변경, 팀원 빼기, 미배정/다른 팀 회원 이동을 바로 수행할 수 있다.
- 팀 프로젝트 회차마다 해당 시점의 학기 팀을 재사용한다.
- 팀원 중 한 명이 제출/수정하면 팀 전체가 같은 제출 상태를 본다.
- 팀이 없는 부원은 팀 프로젝트를 제출할 수 없고 `팀 미배정`으로 표시된다.

### 일정은 캘린더 반복 규칙으로 만든다

운영진의 일정 추가 화면은 먼저 **일반 일정**과 **프로젝트 제출**을 구분한다.

- 일반 일정 — 세미나/CTF/회의/발표/기타를 캘린더에 표시
- 프로젝트 제출 — 각 발생 회차마다 실제 `assignments` 제출창 생성

두 종류 모두 다음 반복 규칙을 사용할 수 있다.

- 반복 안 함
- 매일
- 매주 — 요일 복수 선택 가능
- 매월
- 반복 간격 — 예: 매 2주, 매 3개월
- 종료 — N회 후 / 특정 날짜까지 / 계속

`계속`은 고정된 회차 수로 잘라 저장하지 않는다. `schedule_series`에 반복 규칙을 유지하고, 로그인/일정 조회 시 앞으로 약 6개월 구간을 자동 materialize한다. 시간이 지나면 다음 구간이 계속 채워진다.

프로젝트 제출 일정은 추가로 `개인 / 팀 / 개인↔팀 교대` 패턴을 정한다. 생성된 각 회차는 독립 `assignments` row이므로 기존 제출·지각·검토·ProjectDB 승인 흐름을 그대로 사용한다.

프로젝트 회차에는 다음 값이 유지된다.

- `opens_at` — 제출 시작
- `due_at` — 마감
- `project_type` — 개인/팀
- `round_key` — 회차 식별자

표시 방식은 데이터 저장과 분리한다.

- 다가오는 일정/전체 일정/프로젝트 상세 — `opens_at → due_at` 전체 제출기간 표시
- 월간 달력 — 프로젝트를 `due_at` 날짜 한 번만 `… 마감`으로 표시
- 일반 일정 — 기존처럼 `start_at` 날짜에 표시

운영진은 `전체 일정 → 일괄 수정`에서 여러 일정/프로젝트 회차를 체크해 한 화면에서 제목·시작·종료/마감을 수정하고 한 번에 저장할 수 있다. 선택 항목 전체를 `+N일/-N일` 이동하는 보조 기능도 제공한다. 기존 row의 optimistic `version`을 그대로 사용하므로 다른 운영진이 먼저 수정한 항목은 stale 저장으로 덮어쓰지 않는다. 반복 규칙으로 생성된 특정 회차를 이 화면에서 수정하면 **그 발생 회차만** 바뀌며 반복 규칙 자체는 그대로 남는다. 반복 전체를 바꾸려면 별도의 `반복 규칙 수정`을 사용한다.

따라서 월간 달력이 매주 프로젝트 막대로 가득 차지 않으면서 실제 제출 가능 기간은 잃지 않는다.

### 지각 제출

마감 이후에도 제출은 닫히지 않는다.

- `first_submitted_at <= due_at` — 정상 제출
- `first_submitted_at > due_at` — 지각 제출

지각 여부는 **최초 성공 제출 시각**으로 고정한다. 정상 제출 후 마감 뒤에 내용을 수정해도 지각으로 바뀌지 않는다. 검토 상태(`제출완료 / 수정요청 / 승인`)와 지각 여부는 별개다.

## 프로젝트 현황

운영진 현황은 두 단계로 나눈다.

`/member/operations/progress`의 **전체 현황**은 부원 1명당 1행으로 학기 전체를 요약한다.

- 현재 팀
- 개인 프로젝트 승인/제출/미제출/예정/수정요청/지각
- 팀 프로젝트 승인/제출/미제출/예정/수정요청/지각/팀 미배정
- `팀 미배정 → 미제출 → 수정요청 → 검토대기 → 완료` 순으로 확인이 필요한 부원을 먼저 표시

`/member/operations/submissions`의 **회차별 현황**은 특정 회차를 자세히 본다.

- 개인 프로젝트 — 제출 대상 부원 1명당 1행
- 팀 프로젝트 — 팀 1개당 1행
- 팀 미배정 부원 — 별도 경고 영역
- 제출 수/대상 수, 지각, 수정요청, 승인 수와 원문 검토/승인

따라서 전체 현황에서 사람별 흐름을 먼저 보고, 문제가 있는 회차는 회차별 현황에서 상세 검토한다.

## 회원관리 — 스프레드시트 방식

`/member/operations/members`는 셀을 직접 편집하는 작업표다.

주요 열:

1. 로그인 아이디
2. 이름
3. 권한 (`부원` / `운영진`)
4. 관리 (`비밀번호 초기화`)
5. 저장 결과

기존 `이번 학기 활동`, `GitHub`, `계정 상태` 필드는 데이터 호환성을 위해 DB에 남겨 두지만 일반 회원관리 UI에서는 노출하거나 수정하지 않는다. 신규 회원은 현재 학기 활동/계정 활성 상태와 GitHub 미설정 상태로 생성한다.

### 직접 편집과 일괄 변경

- 기존 로그인 아이디는 변경하지 않는다.
- 여러 행을 선택해 권한만 일괄 변경할 수 있다.
- 입력 중에는 DB에 쓰지 않는다.
- `변경사항 저장`을 눌렀을 때 변경된 행만 `member-bulk`로 보낸다.
- 기존 행은 profile `version`을 함께 보내 stale 화면이 새 데이터를 덮어쓰지 못하게 한다.

### Excel / Google Sheets 붙여넣기

Google Sheets API/OAuth 직접 연동은 하지 않는다. 대신 Sheet/Excel 셀 범위를 복사해서 `붙여넣기`에 그대로 넣을 수 있다.

기본 열 순서:

```text
로그인 아이디 | 이름 | 권한
```

헤더를 포함해 붙여넣는 경우 `member_id`, `name`, `role`, `temporary_password`를 사용할 수 있다. 과거 파일의 `semester_active`, `github_username`, `account_active` 헤더도 파서는 읽을 수 있지만 회원관리 화면으로 가져올 때는 숨김 필드 값을 적용하지 않고 안전한 신규 기본값을 사용한다.

붙여넣기/파일 가져오기는 항상 **미리보기 → 그리드에 적용 → 변경사항 저장** 순서다. 미리보기 자체는 Supabase에 아무것도 쓰지 않는다.

### CSV / XLSX

- CSV 가져오기/내보내기
- XLSX 가져오기/내보내기
- XLSX 템플릿 다운로드
- 한글 헤더 지원
- CSV quoted comma/newline/escaped quote 지원
- XLSX는 일반 OOXML workbook의 첫 번째 worksheet를 읽는다.

일반 회원 내보내기에는 임시 비밀번호를 넣지 않는다. 템플릿에는 신규 계정을 위한 선택 열 `임시 비밀번호`만 포함한다.

### 기존 회원 비밀번호 초기화

저장된 회원 행의 `관리` 열에서 `비밀번호 초기화`를 실행할 수 있다.

- 운영진 JWT/DB role을 확인하는 `member-admin`만 Auth 비밀번호를 변경한다.
- 운영진이 평문 비밀번호를 직접 입력하지 않아도 서버가 강한 랜덤 임시 비밀번호를 생성한다.
- 생성된 값은 해당 응답에서만 한 번 반환해 기존 `새 계정 임시 비밀번호` 패널에 표시한다.
- DB, localStorage, sessionStorage, 일반 회원 CSV/XLSX export에는 저장하지 않는다.
- 운영진은 표시된 값을 복사/credential CSV로 전달하고 사용자는 로그인 후 본인 비밀번호 변경 화면을 사용할 수 있다.

### 신규 계정 일괄 발급

새 행에 임시 비밀번호가 없으면 `member-bulk`가 서버에서 강한 랜덤 임시 비밀번호를 만든다.

- 평문 비밀번호를 DB에 저장하지 않는다.
- 생성된 임시 비밀번호는 해당 bulk 응답에 한 번만 반환한다.
- 브라우저는 React state에만 보관하며 localStorage/sessionStorage에 저장하지 않는다.
- 즉시 클립보드 복사 또는 credential CSV 다운로드가 가능하다.
- 한 행이 실패해도 독립적인 다른 정상 행은 저장된다.

## ProjectDB / Markdown 제출

실제 승인 보고서는 기존 `ssu-asc/ProjectDB` Markdown/Git history가 원본이다. 개인/팀 보고서 모두 같은 ProjectDB를 사용하며 별도 보고서 저장소를 만들지 않는다.

회원 제출 화면은 ProjectDB 경로·branch·tag·commit을 받지 않는다. GitHub에서 직접 파일을 만들 필요도 없다. 새 제출 화면을 열면 ProjectDB의 격주 진행 보고서 구조를 기준으로 한 **인라인 Markdown 템플릿**이 자동으로 채워진다.

```text
프로젝트명 — assignment에서 자동
보고서 본문 — 사이트 안에서 바로 작성, ProjectDB 템플릿 자동 적용
템플릿 다운로드 — 선택, 외부 에디터를 쓰고 싶을 때만 사용
기존 .md 불러오기 — 선택, 이미 작성한 파일이 있을 때만 사용
간단한 설명 / 코드 GitHub 저장소 — 추가 정보, 선택
```

팀 프로젝트 템플릿은 ProjectDB `templates/report-template.md`의 `팀 전체 진행 현황 / 개인별 기여 내역 / 이슈 및 해결 방안 / 다음 회차 목표 / 참고 자료` 흐름을 사용하고, 확정 팀명·팀원·활동 기간을 ASC_WEB이 미리 채운다. 개인 프로젝트는 같은 보고 흐름을 개인용으로 단순화해 불필요한 팀 기여도 입력을 요구하지 않는다.

작성 중인 본문은 제출 시 `submissions.report_markdown` text로 저장한다. Supabase Storage는 사용하지 않는다. 외부에서 기존 ProjectDB Markdown을 불러와 YAML frontmatter가 포함되어 있더라도, member-controlled metadata를 신뢰하지 않도록 ASC_WEB이 frontmatter를 제거하고 본문만 사용한다. 승인 시에는 실제 회원/팀/회차 정보를 이용해 신뢰 가능한 frontmatter를 서버에서 다시 생성한다. 최대 본문 크기는 UTF-8 256 KiB다.

승인 후 ProjectDB 경로:

```text
팀:   reports/{YYYY}/{팀명}/{round_key}-{프로젝트명}/report-01.md
개인: reports/{YYYY}/개인/{학번}-{round_key}-{프로젝트명}/report-01.md
```

ProjectDB에는 `source: asc_web`, `project_type: individual|team`, 프로젝트명, 팀/회원 목록, 제출일, portal submission ID가 기록된다. CL/기여도는 근거 없이 자동 생성하지 않는다. ProjectDB write 결과의 immutable commit SHA를 `submitted_ref`로 저장한다.

승인 상태는 GitHub/Notion 동기화 실패와 독립적이다. publish가 실패해도 승인 자체는 유지되고 운영진이 재시도할 수 있다. migration 011 이전의 historical 제출은 기존 `portal-index/{semester}/{project_type}/{submission_id}/v{version}.json` archive 경로를 계속 사용한다.

## 보안 경계

브라우저에는 아래만 들어간다.

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

외부 자료는 학기별 `resource_links`로 저장하고, 비밀이 아닌 인수인계 정보는 global `운영진 메모`에 저장한다. 공용 계정의 비밀번호/토큰을 실제로 보관해야 하는 경우에는 일반 포털 테이블이 아니라 **Supabase Vault**에만 암호화 저장하고, 명시적인 운영진 `보기/복사` 요청에서만 잠깐 복호화한다. ASC_WEB 로그인은 링크의 발견 범위를 제한할 뿐 외부 서비스의 공유 권한을 대체하지 않는다.

다음 값은 브라우저나 `NEXT_PUBLIC_*`에 절대 넣지 않는다.

- Supabase service role/secret key
- GitHub token
- ProjectDB write token
- DB password
- Supabase service-role key
- ProjectDB 운영 토큰

계정/팀/회차/제출/검토/공용 비밀정보 등 privileged 작업은 Edge Function에서 실제 JWT와 DB `profiles.role`을 다시 확인한다. `staff-secrets`는 목록에서 평문 비밀을 반환하지 않고, `reveal`에서만 `Cache-Control: no-store, private`로 반환한다.

## Supabase 설정

### 1. Auth

- 공개 sign-up 비활성화
- anonymous sign-in 비활성화
- 사이트에서 self signup UI 제공하지 않음

### 2. Migration

순서:

```text
202609150001_member_portal.sql
202609150002_operations.sql
202609150003_staff_guard.sql
202609150004_submission_concurrency.sql
202609150005_final_concurrency.sql
202609150006_roster_schedule_concurrency.sql
202609150007_operations_redesign.sql
202609160008_google_operations_settings.sql
202609160009_resource_hub.sql
202609160010_staff_shared_secrets.sql
202609160011_markdown_submission.sql
```

007은 다음을 추가한다.

- assignment 제출 시작시간/버전
- 최초 제출시간
- 학기 고정 팀 관리 concurrency/RPC
- 내 팀만 노출하는 privacy-minimized RPC
- 단일/반복 프로젝트 회차 atomic 생성
- 기존 알려진 placeholder assignment 비활성화
- 기존 운영진을 프로젝트 제출 대상에서 제외

008은 초기 Google workspace 고정 링크 4개를 위한 staff-only 설정 테이블을 추가했다.

009는 Phase 8 범용 자료실 모델을 추가한다.

- `staff_workspace_settings.google_account_email` — 당시 인수인계용 참고 이메일(010 이후 runtime-deprecated)
- `resource_links` — title/description/url/service/category/audience/order/active/version
- 회원은 현재 학기의 `active=true`, `audience='member'` 링크만 RLS로 조회
- 운영진은 회원/운영진 링크 전체를 관리
- 008의 기존 Form/Sheet/Drive/Template 값은 009 적용 시 동일 학기의 staff-only `resource_links`로 한 번 이관
- 기존 008 컬럼은 호환성을 위해 남기지만 새 runtime은 사용하지 않음
- 브라우저 direct mutation은 허용하지 않고 `operations-settings`만 쓰기 수행

010은 Phase 9 운영진 메모/공용 비밀정보 모델을 추가한다.

- Supabase Vault(`supabase_vault`) 활성화
- global `staff_private_settings.staff_memo`
- metadata-only `staff_shared_secrets` + Vault UUID 참조
- `staff_shared_secret_audit` 접근 기록
- Vault create/update/reveal을 감싸는 service-role-only atomic SQL 함수
- 기존 `google_account_email` 값이 있으면 초기 운영진 메모에 비밀이 아닌 참고정보로 보존
- 브라우저 roles는 Vault/secret metadata/audit/RPC를 직접 호출할 수 없음
- V1은 영구삭제 대신 비활성화/재활성화

011은 Phase 10 Markdown 제출 모델을 추가한다.

- `submissions.report_filename`, `report_markdown`, `report_bytes`
- 승인 전 publication URL/path/ref nullable
- `.md` basename / 1..262144 bytes / DB octet-length consistency check
- 기존 historical 제출은 null Markdown 필드로 계속 유효

**배포 순서:** ProjectDB의 `source: asc_web` validator/Notion 호환 변경을 먼저 통합한 뒤 migration 011과 새 `submission-write`/`submission-admin`을 production에 배포한다.

적용:

```bash
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push --dry-run
npx supabase db push
```

### 3. Edge Function

현재 필요한 함수:

```text
member-admin
member-bulk
team-admin
assignment-admin
submission-write
submission-admin
operations-settings
staff-secrets
```

배포:

```bash
npx supabase functions deploy member-admin
npx supabase functions deploy member-bulk
npx supabase functions deploy team-admin
npx supabase functions deploy assignment-admin
npx supabase functions deploy submission-write
npx supabase functions deploy submission-admin
npx supabase functions deploy operations-settings --use-api
npx supabase functions deploy staff-secrets --use-api
```

### 4. Function secrets

호스팅 Supabase가 제공하는 Supabase 내부 env 외에 필요한 커스텀 설정:

```bash
npx supabase secrets set ASC_WEB_ORIGINS="https://<ASC-운영도메인>"
npx supabase secrets set PROJECTDB_REPOSITORY="ssu-asc/ProjectDB"
npx supabase secrets set PROJECTDB_BRANCH="main"
npx supabase secrets set PROJECTDB_TOKEN="<최소 권한 GitHub token/App token>"
```

ProjectDB가 public이고 제출 검증만 할 때는 unauthenticated GitHub API도 가능하지만, rate limit 안정성을 위해 `PROJECTDB_READ_TOKEN`을 별도로 둘 수도 있다. 승인 sidecar 쓰기는 `PROJECTDB_TOKEN`이 필요하다.

### 5. 정적 프론트 배포

운영 프론트는 기존 **Cloudflare Pages `asc-web`** 프로젝트와 custom domain `https://ssu-asc.com`을 사용한다. custom domain은 루트 배포이므로 production build에 `NEXT_PUBLIC_BASE_PATH`를 설정하지 않는다.

브라우저에 들어가는 값은 다음 두 개뿐이다.

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

로컬/운영 빌드 후 기존 Pages 프로젝트에 배포한다.

```bash
npm run build
npx wrangler pages deploy out --project-name asc-web --branch main
```

GitHub Pages workflow는 repository fallback 용도로 남아 있으며 production custom domain을 소유하지 않는다. fallback 빌드에서만 repository Variable `NEXT_PUBLIC_BASE_PATH=/ASC_WEB`을 사용한다. Supabase publishable key는 브라우저 공개용 키다. service-role/secret key나 ProjectDB token은 정적 빌드 설정에 넣지 않는다.

### 6. 최초 운영진

최초 1명만 Auth + profile + semester membership을 bootstrap한다. 이후 계정은 회원관리에서 발급한다.

운영진 membership 기본값:

```text
active=true
individual_required=false
team_required=false
```

DB `private.staff_guard`가 활성 운영진을 0명으로 만드는 변경을 차단한다.

## 운영진 메모 + 링크 허브 + 공용 계정

ASC_WEB 안에 문서 편집기나 외부 OAuth 자동연동을 만들지 않는다. `/member/operations/settings`는 세 종류의 정보를 분리해서 관리한다.

### 운영진 메모

Google 계정 주소, Instagram, GitHub organization, 소유권/인수인계 설명처럼 **비밀이 아닌 정보**를 자유롭게 적는다.

```text
Google: asc.operations@gmail.com
Instagram: @ssu_asc
GitHub: ssu-asc
기타 인수인계 메모
```

비밀번호/토큰은 메모에 적지 않는다. Google 계정 자체의 소유권/공유 변경은 Google에서 처리하고, 외부 자료 URL이 바뀐 경우에만 링크 모음을 수정한다.

### 링크 모음

각 링크는 다음 값을 가진다.

```text
제목
설명
HTTPS URL
서비스: Notion / Google Drive / Google Docs / Google Sheets / Google Forms / GitHub / Discord / 기타
분류: 스터디 / 프로젝트 / CTF / 모집 / 운영 / 기타
공개 범위: 회원 공개 / 운영진 전용
순서
```

- `회원 공개` — `/member/resources`에서 활동회원과 운영진이 확인
- `운영진 전용` — `/member/operations/settings`에서만 운영진이 확인
- 기존 Notion 스터디 문서는 옮기지 않고 `service=notion`, `category=study`, `audience=member` 링크로 등록
- 링크가 ASC에 보여도 실제 접근 가능 여부는 Notion/Drive/GitHub/Discord의 공유 설정이 최종 기준
- 공개-by-link Notion 자료는 URL을 전달받은 외부인도 열 수 있으므로 민감 자료에는 사용하지 않음
- 면접/지원자 개인정보처럼 민감한 자료는 Google Drive/Docs의 특정 계정·그룹 권한으로 제한

공개 `/apply` 자체의 지원/CTF/결과 링크는 계속 `public/data/apply.json`을 사용한다. 다만 **메인 화면 리크루팅 팝업**은 더 이상 정적 `isOpen` 값으로 자동 노출하지 않는다. `운영진 설정 → 공개 리크루팅 안내`에서 사용 여부, 제목, 설명, 버튼 문구/주소, 노출 시작·종료 시각을 관리한다. migration 012의 기본값은 `enabled=false`이므로 운영진이 명시적으로 켜기 전에는 팝업이 뜨지 않는다.

Apps Script 자동화와 외부 API 동기화는 V1 범위 밖이다.

### 공용 계정 / 비밀정보

운영진이 함께 쓰는 Google/Instagram/GitHub 등 공용 계정의 비밀번호나 기타 비밀값은 Supabase Vault에 암호화 저장한다.

- 목록 조회는 label/account/login URL/상태/version 같은 metadata만 반환
- `보기`/`복사` 때만 staff-authenticated `staff-secrets`가 Vault 값을 복호화
- `보기` 결과는 화면에서 최대 30초 뒤 자동 제거
- `복사` 후 화면 평문 state는 즉시 제거
- reveal/copy는 `revealed` audit event로 남음
- 비활성화된 secret은 reveal 불가, 재활성화 가능
- localStorage/sessionStorage/IndexedDB/URL/CSV/XLSX/로그/analytics에 평문을 넣지 않음
- Vault UUID도 browser API 응답에 노출하지 않음
- 운영체제 clipboard history는 ASC_WEB이 지울 수 없음

Vault는 DB/백업에서 secret을 암호화 상태로 보존하는 경계를 제공하지만, 이미 탈취된 활성 운영진 세션이 명시적으로 reveal하는 것까지 막지는 못한다. reveal 전 step-up MFA/re-authentication은 차후 hardening 범위다.

## 로컬 검증

```bash
npm test
npm run typecheck
npm run build
npm run test:browser
npm run test:integration
npm run test:edge
git diff --check
```

`test:integration`은 localhost/127.0.0.1이 아닌 Supabase URL에서는 실행을 거부하고, disposable local DB를 reset해 실제 Auth/PostgREST/RLS/Edge Functions를 검증한다. `test:edge`는 실제 hosted Supabase의 Edge preflight를 localhost/127.0.0.1/0.0.0 개발 origin, ASC_WEB 전용 3010 개발 포트, production `https://ssu-asc.com`, GitHub Pages fallback origin에서 검사하고 POST 경로가 브라우저 fetch/CORS 실패가 아니라 HTTP 응답까지 도달하는지 확인한다.

현재 주요 검증 범위:

- local migration 001–011 실제 적용 + production migration 011 배포 완료
- Auth 로그인 / RLS
- 마지막 활성 운영진 보호 및 동시성
- `member-admin` 단일 계정 작업 + 서버 생성 임시 비밀번호 초기화 후 실제 재로그인
- `member-bulk` 일괄 생성/수정/부분실패/랜덤 credential/일반회원 거부
- 운영진 생성 계정의 제출대상 자동 제외
- `team-admin` 학기 고정 팀 생성/배정 및 stale move 충돌
- 부원의 broad team roster 접근 차단 / 자기 팀만 조회
- `assignment-admin` 단일 회차 및 교대 반복 회차 atomic 생성
- 제출 시작 전 차단 / 마감 후 허용
- 개인/고정팀 공동 제출
- stale 제출/검토 차단
- `.md` 파일명/UTF-8 byte size/frontmatter server validation + 개인/고정팀 공동 제출
- 운영진 exact Markdown 원문 검토 + 승인 시 trusted 개인/팀 ProjectDB path/frontmatter 생성
- ProjectDB publish commit SHA 저장 + 승인 내구성 / sync failure 독립 처리
- historical ref-based submission의 legacy archive sync 하위호환
- `operations-settings` 일반회원 403 / 운영진 메모 optimistic save / 범용 HTTPS 링크 CRUD / stale version 409 / reorder / soft-delete
- `resource_links` RLS — 일반회원은 active member 링크만 조회, staff 링크/비활성 링크는 숨김
- `/member/resources` — 회원 공개 링크만 표시하고 외부 내용을 iframe/API로 복제하지 않음
- `staff-secrets` — 일반회원 403 / staff-only metadata list / Vault create·update·reveal / stale update가 Vault를 바꾸지 않음 / no-store reveal / deactivate·reactivate / audit
- browser direct secret table/audit/RPC/Vault 접근 차단

## 운영 배포 체크

2026-09-17 기준 ProjectDB 호환 변경(PR #80), migration 011, `submission-write`/`submission-admin`, ASC_WEB PR #1, Cloudflare Pages `asc-web`의 `https://ssu-asc.com` production 배포까지 완료했다. `PROJECTDB_REPOSITORY=ssu-asc/ProjectDB`, `PROJECTDB_BRANCH=main`, least-privilege `PROJECTDB_TOKEN`도 hosted Supabase에 설정되어 있다. 첫 실제 승인 1건은 ProjectDB `report-01.md`와 immutable commit SHA를 확인하는 운영 smoke로 사용한다. Notion 동기화는 v1.0 완료 조건이 아니다.

1. Auth public sign-up이 꺼져 있는가.
2. Phase 10 release 전 ProjectDB `source: asc_web` validator/Notion 호환 변경이 먼저 통합됐는가.
3. 그 다음 migration 001–011이 적용되고 변경된 `submission-write` / `submission-admin`이 배포됐는가.
4. 기존 Edge Function(`operations-settings`, `staff-secrets` 포함)이 계속 최신 상태인가.
5. 첫 운영진 profile/membership이 일치하는가.
6. 운영진이 프로젝트 제출 대상에서 빠져 있는가.
7. 학기 팀 편성을 완료했는가.
8. 월간 달력은 프로젝트를 마감일에만 표시하고 목록/상세는 전체 제출기간을 표시하는가.
9. `ASC_WEB_ORIGINS`가 실제 사이트 origin과 일치하고 `npm run test:edge`가 통과하는가.
10. Cloudflare Pages production build가 browser-safe Supabase URL/publishable key를 사용하고 `ssu-asc.com` 루트 경로로 배포됐는가.
11. 운영진 메모와 현재 학기 링크 모음이 최신이며 메모에 비밀번호/토큰이 들어가 있지 않은가.
12. 기존 Notion/Drive/GitHub/Discord 자료의 실제 외부 공유 권한이 의도와 일치하는가.
13. `회원 공개` 링크만 회원 자료실에서 보이고 `운영진 전용` 링크는 숨겨지는가.
14. 운영진 교체 시 Google Form/Sheet/Drive/Docs 각각의 공유/소유권을 확인했는가.
15. 공용 계정 비밀값은 Vault에만 저장되고 목록/DB metadata/로그/export에 평문이 없는가.
16. `보기/복사`가 감사 로그에 남고 비활성화 secret reveal이 차단되는가.
17. 브라우저 bundle에 service-role/ProjectDB 운영키 같은 privileged secret이 없는가.
18. 첫 실제 Markdown 승인에서 ProjectDB `report-01.md` 생성과 immutable commit SHA 저장을 확인했는가. 이 확인은 운영 smoke이며 승인 실패 시 ProjectDB sync만 재시도한다.
19. 회원/운영진 계정으로 production 권한을 최종 점검했는가.

비밀번호, service-role key, DB password, GitHub token은 채팅/스크린샷/Git에 남기지 않는다.
