"use client";

import { useEffect, useMemo, useState } from "react";
import { MemberGate, useMemberSession } from "@/component/member/MemberSession";
import { MemberToolbar } from "@/component/member/MemberToolbar";
import { readSubmissionOverview, reviewSubmission, type SubmissionOverview } from "@/lib/member-api";
import {
  formatDeadline,
  isActiveStaff,
  STATE_LABELS,
  type Profile,
  type ProjectRoundDetailRow,
  type ProjectRoundSummary,
} from "@/lib/member-domain";
import styles from "@/styles/member.module.css";

type View = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: SubmissionOverview };
type StatusFilter = "all" | "not_submitted" | "submitted" | "late" | "revision_requested" | "approved";

function reportHref(row: ProjectRoundDetailRow): string | null {
  const submission = row.submission;
  if (!submission?.submitted_ref || !submission.report_path || !submission.report_repository_url) return null;
  const ref = submission.submitted_ref.split("/").map(encodeURIComponent).join("/");
  const path = submission.report_path.split("/").map(encodeURIComponent).join("/");
  return `${submission.report_repository_url.replace(/\/$/, "")}/blob/${ref}/${path}`;
}

function ReviewActions({ row, onSaved }: { row: ProjectRoundDetailRow; onSaved: () => void }) {
  const { client } = useMemberSession();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(row.submission?.review_note ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!row.submission) return <span className={styles.secondary}>제출 전</span>;

  const submitReview = async (status: "revision_requested" | "approved") => {
    if (!client || !row.submission) return;
    setBusy(true); setMessage(null);
    try {
      const result = await reviewSubmission(client, {
        action: "review", submission_id: row.submission.id, expected_version: row.submission.version, status, review_note: note,
      });
      setMessage(status === "approved"
        ? result.projectdb_sync_status === "synced" ? "승인했고 ProjectDB에 동기화했습니다." : `승인했습니다. ProjectDB: ${result.projectdb_sync_status ?? "확인 필요"}`
        : "수정요청으로 변경했습니다.");
      onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "검토 상태를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const retrySync = async () => {
    if (!client || !row.submission) return;
    setBusy(true); setMessage(null);
    try {
      const result = await reviewSubmission(client, { action: "retry_projectdb_sync", submission_id: row.submission.id, expected_version: row.submission.version });
      setMessage(result.projectdb_sync_status === "synced" ? "ProjectDB 동기화를 완료했습니다." : result.projectdb_sync_error ?? "ProjectDB 동기화에 실패했습니다.");
      onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "동기화를 다시 시도하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const href = reportHref(row);
  return <div className={styles.reviewActions}>
    <button className={styles.smallButton} onClick={() => setOpen((value) => !value)}>{open ? "닫기" : "검토"}</button>
    {open && <div className={styles.inlineEditor}>
      <p><strong>{row.submission.title}</strong></p>
      {row.submission.report_filename && <div className={styles.reviewNote}>
        <strong>업로드 보고서</strong>
        <p>{row.submission.report_filename}{row.submission.report_bytes ? ` · ${row.submission.report_bytes.toLocaleString("ko-KR")} bytes` : ""}</p>
      </div>}
      {row.submission.code_repository_url && <a className={styles.textLink} href={row.submission.code_repository_url} target="_blank" rel="noopener noreferrer">코드 저장소 열기 ↗</a>}
      {row.submission.report_markdown ? <div className={styles.reviewNote}>
        <strong>Markdown 원문</strong>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "32rem", overflow: "auto" }}>{row.submission.report_markdown}</pre>
      </div> : <p className={styles.helper}>기존 ProjectDB 제출 · {row.submission.report_path ?? "경로 없음"} · {row.submission.submitted_ref ?? "ref 없음"}</p>}
      {href && <a className={styles.textLink} href={href} target="_blank" rel="noopener noreferrer">승인된 ProjectDB 보고서 열기 ↗</a>}
      <label className={styles.field}>운영진 메모<textarea rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <div className={styles.actions}>
        <button className={styles.smallButton} disabled={busy} onClick={() => void submitReview("revision_requested")}>수정요청</button>
        <button className={styles.button} disabled={busy} onClick={() => void submitReview("approved")}>승인</button>
        {row.submission.status === "approved" && ["failed", "pending"].includes(row.submission.projectdb_sync_status) && <button className={styles.smallButton} disabled={busy} onClick={() => void retrySync()}>ProjectDB 재시도</button>}
      </div>
      <p className={styles.helper}>ProjectDB · {row.submission.projectdb_sync_status}{row.submission.projectdb_sync_error ? ` · ${row.submission.projectdb_sync_error}` : ""}</p>
      {message && <p className={styles.notice} role="status">{message}</p>}
    </div>}
  </div>;
}

function windowLabel(summary: ProjectRoundSummary): string {
  if (summary.window === "open") return "진행중";
  if (summary.window === "overdue") return "마감됨";
  return "예정";
}

function defaultRound(summaries: ProjectRoundSummary[]): string {
  return summaries.find((summary) => summary.window === "open")?.assignment.id
    ?? [...summaries].reverse().find((summary) => summary.window === "overdue")?.assignment.id
    ?? summaries[0]?.assignment.id
    ?? "";
}

function SubmissionOperations({ profile }: { profile: Profile }) {
  const { client } = useMemberSession();
  const [view, setView] = useState<View>({ status: "loading" });
  const [revision, reload] = useState(0);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!client) return;
    let alive = true;
    setView({ status: "loading" });
    void readSubmissionOverview(client, profile).then((data) => {
      if (!alive) return;
      setView({ status: "ready", data });
      setSelectedAssignmentId((current) => data.overview.summaries.some((summary) => summary.assignment.id === current) ? current : defaultRound(data.overview.summaries));
    }).catch((error: unknown) => {
      if (alive) setView({ status: "error", message: error instanceof Error ? error.message : "프로젝트 현황을 불러오지 못했습니다." });
    });
    return () => { alive = false; };
  }, [client, profile, revision]);

  const selected = view.status === "ready"
    ? view.data.overview.summaries.find((summary) => summary.assignment.id === selectedAssignmentId) ?? null
    : null;
  const unassigned = view.status === "ready" && selected ? view.data.overview.unassignedByAssignment[selected.assignment.id] ?? [] : [];
  const rows = useMemo(() => {
    if (view.status !== "ready" || !selected) return [];
    const term = search.trim().toLocaleLowerCase();
    return (view.data.overview.detailsByAssignment[selected.assignment.id] ?? []).filter((row) => {
      const statusMatches = status === "all"
        || (status === "not_submitted" && !row.submission)
        || (status === "submitted" && Boolean(row.submission))
        || (status === "late" && row.late)
        || (status === "revision_requested" && row.state === "revision_requested")
        || (status === "approved" && row.state === "approved");
      const searchMatches = !term || [row.display_name, row.secondary, ...row.member_names, row.submission?.title ?? ""].some((value) => value.toLocaleLowerCase().includes(term));
      return statusMatches && searchMatches;
    });
  }, [view, selected, status, search]);

  return <main className={styles.page}>
    <MemberToolbar profile={profile} />
    <p className={styles.eyebrow}>ASC OPERATIONS</p>
    <h1 className={styles.title}>{view.status === "ready" && view.data.semester ? `${view.data.semester.id} 회차별 현황` : "회차별 현황"}</h1>
    <p className={styles.description}>특정 회차를 자세히 보는 화면입니다. 개인 프로젝트는 회원별, 팀 프로젝트는 팀별 제출·지각·검토 상태를 확인할 수 있습니다.</p>

    {view.status === "loading" && <p className={styles.notice}>프로젝트 현황을 불러오고 있습니다.</p>}
    {view.status === "error" && <section className={styles.notice} role="alert"><p>{view.message}</p><button className={styles.button} onClick={() => reload((value) => value + 1)}>다시 불러오기</button></section>}
    {view.status === "ready" && <>
      {view.data.overview.summaries.length === 0 ? <p className={styles.notice}>등록된 프로젝트 회차가 없습니다. 일정에서 프로젝트 회차를 만들어 주세요.</p> : <>
        <div className={styles.roundStrip} aria-label="프로젝트 회차">
          {view.data.overview.summaries.map((summary, index) => <button
            key={summary.assignment.id}
            className={styles.roundButton}
            data-active={summary.assignment.id === selectedAssignmentId}
            onClick={() => { setSelectedAssignmentId(summary.assignment.id); setStatus("all"); setSearch(""); }}
          >
            <span>{index + 1}회차 · {summary.assignment.project_type === "individual" ? "개인" : "팀"}</span>
            <strong>{summary.assignment.title}</strong>
            <small>{windowLabel(summary)} · 제출 {summary.submitted}/{summary.total_expected}{summary.late > 0 ? ` · 지각 ${summary.late}` : ""}</small>
          </button>)}
        </div>

        {selected && <>
          <section className={styles.statsGrid}>
            <div><strong>{selected.total_expected}</strong><span>{selected.assignment.project_type === "individual" ? "제출 대상 회원" : "제출 대상 팀"}</span></div>
            <div><strong>{selected.submitted}</strong><span>제출</span></div>
            <div><strong>{selected.total_expected - selected.submitted}</strong><span>미제출</span></div>
            <div><strong>{selected.late}</strong><span>지각</span></div>
            <div><strong>{selected.revision_requested}</strong><span>수정요청</span></div>
            <div><strong>{selected.approved}</strong><span>승인</span></div>
          </section>

          <section className={styles.scheduleSection}>
            <div className={styles.headingRow}><div><span className={styles.scheduleCategory}>{selected.assignment.project_type === "individual" ? "개인 프로젝트" : "팀 프로젝트"}</span><h2>{selected.assignment.title}</h2><p className={styles.helper}>제출 시작 {formatDeadline(selected.assignment.opens_at)} · 마감 {formatDeadline(selected.assignment.due_at)}</p></div></div>
            {selected.assignment.project_type === "team" && unassigned.length > 0 && <div className={styles.notice}><strong>팀 미배정 {unassigned.length}명</strong><p>{unassigned.map((member) => `${member.name} · ${member.member_id}`).join(", ")}</p></div>}
            <div className={styles.filters}>
              <label>상태<select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">전체</option><option value="not_submitted">미제출</option><option value="submitted">제출완료</option><option value="late">지각</option><option value="revision_requested">수정요청</option><option value="approved">승인</option></select></label>
              <label>검색<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="이름·팀·프로젝트" /></label>
            </div>
            <div className={styles.tableWrap}><table className={styles.roster}>
              <thead><tr><th>{selected.assignment.project_type === "individual" ? "회원" : "팀"}</th><th>구성</th><th>상태</th><th>제출시간</th><th>검토</th></tr></thead>
              <tbody>{rows.map((row) => <tr key={row.key}>
                <td data-label={selected.assignment.project_type === "individual" ? "회원" : "팀"}><strong>{row.display_name}</strong><span className={styles.secondary}>{row.secondary}</span></td>
                <td data-label="구성">{row.kind === "team" ? row.member_names.join(", ") : "-"}</td>
                <td data-label="상태"><span className={styles.badge} data-state={row.state}>{STATE_LABELS[row.state]}</span>{row.late && <span className={styles.lateBadge}>지각</span>}</td>
                <td data-label="제출시간">{row.submission ? formatDeadline(row.submission.first_submitted_at) : "-"}</td>
                <td data-label="검토"><ReviewActions row={row} onSaved={() => reload((value) => value + 1)} /></td>
              </tr>)}</tbody>
            </table></div>
            {rows.length === 0 && <p className={styles.notice}>조건에 맞는 제출 대상이 없습니다.</p>}
          </section>
        </>}
      </>}
    </>}
  </main>;
}

export default function SubmissionOperationsPage() {
  const { state } = useMemberSession();
  return <MemberGate staffOnly>{state.status === "ready" && isActiveStaff(state.profile) && <SubmissionOperations profile={state.profile} />}</MemberGate>;
}
