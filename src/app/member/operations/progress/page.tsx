"use client";

import { useEffect, useMemo, useState } from "react";
import { MemberGate, useMemberSession } from "@/component/member/MemberSession";
import { MemberToolbar } from "@/component/member/MemberToolbar";
import { readSubmissionOverview, type SubmissionOverview } from "@/lib/member-api";
import {
  isActiveStaff,
  type MemberProjectProgressBucket,
  type MemberProjectProgressRow,
  type MemberProjectProgressState,
  type Profile,
} from "@/lib/member-domain";
import styles from "@/styles/member.module.css";

type View = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: SubmissionOverview };
type ProgressFilter = "all" | MemberProjectProgressState;

const PROGRESS_LABELS: Record<MemberProjectProgressState, string> = {
  complete: "전체 완료",
  waiting: "검토 대기",
  revision: "수정요청 있음",
  missing: "미제출 있음",
  unassigned: "팀 미배정",
  none: "프로젝트 없음",
};

function bucketSummary(bucket: MemberProjectProgressBucket) {
  if (bucket.expected === 0) return <span className={styles.secondary}>대상 없음</span>;
  return <div className={styles.progressCell}>
    <strong>승인 {bucket.approved}/{bucket.expected}</strong>
    <span>제출 {bucket.submitted}</span>
    {bucket.missing > 0 && <span>미제출 {bucket.missing}</span>}
    {bucket.upcoming > 0 && <span>예정 {bucket.upcoming}</span>}
    {bucket.revision_requested > 0 && <span>수정 {bucket.revision_requested}</span>}
    {bucket.unassigned > 0 && <span>팀 미배정 {bucket.unassigned}</span>}
    {bucket.late > 0 && <span>지각 {bucket.late}</span>}
  </div>;
}

function OverallProgress({ profile }: { profile: Profile }) {
  const { client } = useMemberSession();
  const [view, setView] = useState<View>({ status: "loading" });
  const [revision, reload] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ProgressFilter>("all");

  useEffect(() => {
    if (!client) return;
    let alive = true;
    setView({ status: "loading" });
    void readSubmissionOverview(client, profile)
      .then((data) => { if (alive) setView({ status: "ready", data }); })
      .catch((error: unknown) => { if (alive) setView({ status: "error", message: error instanceof Error ? error.message : "전체 프로젝트 현황을 불러오지 못했습니다." }); });
    return () => { alive = false; };
  }, [client, profile, revision]);

  const rows = useMemo(() => {
    if (view.status !== "ready") return [];
    const term = search.trim().toLocaleLowerCase();
    return view.data.memberProgress.filter((row) => {
      const matchesFilter = filter === "all" || row.overall_state === filter;
      const matchesSearch = !term || [row.profile.name, row.profile.member_id, row.team?.name ?? ""].some((value) => value.toLocaleLowerCase().includes(term));
      return matchesFilter && matchesSearch;
    });
  }, [view, search, filter]);

  const stats = useMemo(() => {
    if (view.status !== "ready") return { members: 0, individualMissing: 0, teamMissing: 0, revision: 0, complete: 0 };
    const data = view.data.memberProgress;
    return {
      members: data.length,
      individualMissing: data.filter((row) => row.individual.missing > 0).length,
      teamMissing: data.filter((row) => row.team_projects.missing > 0 || row.team_projects.unassigned > 0).length,
      revision: data.filter((row) => row.individual.revision_requested + row.team_projects.revision_requested > 0).length,
      complete: data.filter((row) => row.overall_state === "complete").length,
    };
  }, [view]);

  return <main className={styles.page}>
    <MemberToolbar profile={profile} />
    <p className={styles.eyebrow}>ASC OPERATIONS</p>
    <h1 className={styles.title}>{view.status === "ready" && view.data.semester ? `${view.data.semester.id} 전체 현황` : "전체 현황"}</h1>
    <p className={styles.description}>회차 하나를 깊게 보는 화면이 아니라, 각 부원이 학기 전체 개인·팀 프로젝트를 어떻게 진행하고 있는지 한눈에 확인하는 화면입니다.</p>

    {view.status === "loading" && <p className={styles.notice}>전체 프로젝트 현황을 불러오고 있습니다.</p>}
    {view.status === "error" && <section className={styles.notice} role="alert"><p>{view.message}</p><button className={styles.button} onClick={() => reload((value) => value + 1)}>다시 불러오기</button></section>}
    {view.status === "ready" && <>
      <section className={styles.progressStats}>
        <div><strong>{stats.members}</strong><span>부원</span></div>
        <div><strong>{stats.individualMissing}</strong><span>개인 미제출</span></div>
        <div><strong>{stats.teamMissing}</strong><span>팀 확인 필요</span></div>
        <div><strong>{stats.revision}</strong><span>수정요청</span></div>
        <div><strong>{stats.complete}</strong><span>전체 완료</span></div>
      </section>

      <section className={styles.scheduleSection}>
        <div className={styles.headingRow}>
          <div>
            <h2>부원별 프로젝트 진행</h2>
            <p className={styles.helper}>미제출·팀 미배정·수정요청이 있는 부원이 먼저 보입니다. 팀 프로젝트 제출은 같은 팀원에게 동일하게 반영됩니다.</p>
          </div>
        </div>
        <div className={styles.filters}>
          <label>상태<select value={filter} onChange={(event) => setFilter(event.target.value as ProgressFilter)}>
            <option value="all">전체</option>
            <option value="unassigned">팀 미배정</option>
            <option value="missing">미제출 있음</option>
            <option value="revision">수정요청 있음</option>
            <option value="waiting">검토 대기</option>
            <option value="complete">전체 완료</option>
            <option value="none">프로젝트 없음</option>
          </select></label>
          <label>검색<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="이름·아이디·팀" /></label>
        </div>

        <div className={styles.tableWrap}><table className={`${styles.roster} ${styles.progressTable}`}>
          <thead><tr><th>회원</th><th>팀</th><th>개인 프로젝트</th><th>팀 프로젝트</th><th>현재 상태</th></tr></thead>
          <tbody>{rows.map((row: MemberProjectProgressRow) => <tr key={row.profile.id}>
            <td data-label="회원"><strong>{row.profile.name}</strong><span className={styles.secondary}>{row.profile.member_id}</span></td>
            <td data-label="팀">{row.team?.name ?? <span className={styles.secondary}>미배정</span>}</td>
            <td data-label="개인 프로젝트">{bucketSummary(row.individual)}</td>
            <td data-label="팀 프로젝트">{bucketSummary(row.team_projects)}</td>
            <td data-label="현재 상태"><span className={styles.progressState} data-state={row.overall_state}>{PROGRESS_LABELS[row.overall_state]}</span></td>
          </tr>)}</tbody>
        </table></div>
        {rows.length === 0 && <p className={styles.notice}>조건에 맞는 부원이 없습니다.</p>}
      </section>
    </>}
  </main>;
}

export default function OverallProgressPage() {
  const { state } = useMemberSession();
  return <MemberGate staffOnly>{state.status === "ready" && isActiveStaff(state.profile) && <OverallProgress profile={state.profile} />}</MemberGate>;
}
