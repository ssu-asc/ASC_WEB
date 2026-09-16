# Phase 1 Spec — Member Accounts + Portal Tracer

## Objective

기존 공개 ASC 디자인을 유지하며, 발급 계정으로 로그인하여 실제 제출 상태를 읽고 운영진이 학기별 회원명단을 관리한다. 구현은 읽기 tracer → 신뢰된 서버 계정관리 → 실환경 검증 순서다. 첫 구간의 코드/빌드가 완성되어도 전체 Phase 1 완료가 아니다.

## User Story

부원은 자신의 개인·팀 프로젝트 제출 상태를 확인하고, 운영진은 이번 학기에 제출해야 하는 부원 명단을 기준으로 관리한다. 등록되지 않은 사람을 미제출로 계산하지 않는다.

## Scope

포함: Supabase 브라우저 클라이언트, 프로필·학기·활동명단·팀·제출 읽기 모델, RLS, 발급계정 로그인, 본인 비밀번호 변경, Member 메뉴, 대시보드, 운영진 회원관리와 서버 계정 발급/수정/초기화.

제외: Git 제출 폼/팀 배정 편집/ProjectDB 연동(Phase 2), 운영진 제출 검토(Phase 3), 일정(Phase 4). PDF 저장소는 만들지 않는다. 공개 홈페이지 본문을 변경하지 않는다.

## Data Contract

### profiles

`id uuid` = auth.users.id, `member_id text` 고정 로그인 ID(정규화된 영문 소문자/숫자/밑줄/하이픈, 3~32자), `name`, `role: member|staff`, `active`, `github_username nullable`, `created_at`.

로그인 ID와 권한은 회원이 직접 수정하지 않는다. 사용자 metadata로 운영진 여부를 판단하지 않는다.

### semesters / semester_memberships

semesters: `id`(2026-2), `title`, `active`, `is_current`. 현재 학기는 최대 하나다.

semester_memberships: `(profile_id, semester)` 복합 PK, `active`, `individual_required`, `team_required`, `created_at`.

계정 활성과 학기 활동은 별개다. 명단 미등록/비활동은 미제출 대상에서 제외하고, 제출 면제는 `제출 대상 아님`으로 표시한다.

### teams / team_members

teams: `id`, `semester`, `name`. 같은 학기 팀 이름은 유일하다.

team_members: `team_id`, `profile_id`, `semester`. 회원당 학기별 확정 팀은 하나이며, 팀과 회원 모두 해당 학기에 속해야 한다. 팀원 연결은 제출 데이터가 임의로 생성하지 않는다. `팀 미배정`과 `팀 배정 후 미제출`을 구분한다.

### assignments

`id`, `semester`, `project_type: individual|team`, `round_key`(초기 final), `title`, `description`, `due_at nullable`, `active`.

초기 데이터는 2026-2 개인·팀 제출 항목 두 개다. 마감일은 임의로 만들지 않는다. 기존 ProjectDB report-NN 회차 확장 가능성을 남기되 과거 0~8회차 운영을 자동으로 강제하지 않는다.

### submissions

`id`, `assignment_id`, `semester`, `project_type`, `owner_id nullable`, `team_id nullable`, `title`, `summary`, `code_repository_url nullable`, `report_repository_url`, `report_path`, `submitted_sha`(40자리), `status: submitted|revision_requested|approved`, `review_note nullable`, `submitted_at`.

개인 제출은 owner만, 팀 제출은 team만 갖는다. assignment/semester/type와 소속 FK가 일치해야 한다. 항목별 개인/팀 제출 원장은 하나다. Phase 2에서 재제출 버전 이력을 추가하고 서버에서 full SHA/파일 존재를 검증한 뒤 쓰기를 연다. 현재 migration에는 브라우저 쓰기 권한이 없다.

보고서 저장소는 실제 ProjectDB 형식에 맞춘다. 코드 저장소와 같다고 가정하지 않는다. 태그 문자열 자체를 고정된 제출본이라고 취급하지 않는다.

## Authentication / Authorization

- 내부 Auth 식별자: `member_id@members.asc.invalid`. 실제 수신 이메일이 아니며 이메일 복구는 범위 밖이다.
- 가입 버튼을 없애는 것 외에 Supabase Auth에서 public signup도 비활성화한다.
- 브라우저는 publishable/anon key만 사용한다. 서비스 관리자 키는 서버 함수 환경에만 존재한다.
- 로그인 상태는 /member 전용 provider에서 처리하며 공개 root layout에 Supabase를 로드하지 않는다.
- 로그인/로그아웃/계정 전환 때 이전 사용자의 데이터가 남지 않게 상태를 초기화하고 오래된 비동기 응답을 무시한다.
- RLS가 실제 접근 경계다. 회원은 자신의 최소 프로필과 활성 학기 내 자기/확정팀 데이터를 읽고, 활성 운영진은 명단을 읽는다. 계정 비활성 사용자의 자기 프로필 읽기는 차단 사유 안내에만 사용한다.
- 서버 계정관리 task는 JWT 인증 + 현재 DB 운영진 여부를 매 요청 확인하며, 마지막 운영진 보호/감사기록/부분실패 보상/초기화 후 세션·비밀번호 변경 처리를 포함한다.

## Dashboard States

읽기 실패 → 오류 및 재시도. 연결 설정 없음 → 설정 안내. 처리 중 → 로딩. 등록된 제출 대상이 아님 → 해당 안내.

성공적으로 읽은 항목만 상태를 계산한다:
- 면제 → 제출 대상 아님
- 팀 제출 대상이지만 확정팀 없음 → 팀 미배정
- 제출 대상이며 해당 제출 원장이 없음 → 미제출
- submitted → 제출완료
- revision_requested → 수정요청
- approved → 승인

## Acceptance Criteria

1. 기존 Home/Hall of Fame/Apply/Q&A/Introduce/Contact는 유지하고 Header에 Member 링크만 추가한다. 좁은 데스크톱 간격 조정은 허용하되 겹침 없이 검증한다.
2. Supabase 설정 없이도 build가 성공하고, 로그인 버튼은 비활성화된 연결 안내를 표시한다. 가짜 데이터로 성공을 흉내 내지 않는다.
3. 실제 발급계정 로그인/새로고침/로그아웃/본인 비밀번호 변경이 Supabase에서 확인되어야 한다.
4. 대시보드는 실제 학기/명단/제출 항목/제출 원장을 읽고 조회 실패를 미제출로 바꾸지 않는다.
5. 운영진만 실제 명단을 보고, 일반 회원의 직접 API 접근이 차단된다.
6. 운영진 계정 생성/수정/초기화는 서버 함수로 동작하고 권한·감사·실패 처리 테스트를 통과한다.
7. 모바일·데스크톱 화면에 중요 상태/명단이 hover나 가로 스크롤 없이 표시된다.
8. SQL migration이 있다는 것과 서버에 적용/권한 검증을 마쳤다는 것을 구분한다. 독립 검토와 실환경 검증 전에는 Phase 1을 완료 처리하지 않는다.

## Verification Evidence Location

현재 진행과 테스트는 `01-PROGRESS.md`, 다음 작업은 `.planning/STATE.md`를 따른다. 실제 완료 전에는 완료용 SUMMARY.md를 만들지 않는다.
