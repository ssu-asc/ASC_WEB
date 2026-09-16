"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { MemberGate, useMemberSession } from "@/component/member/MemberSession";
import { MemberToolbar } from "@/component/member/MemberToolbar";
import { readMemberDashboard, saveSubmission, type TeamContext } from "@/lib/member-api";
import { formatDeadline, isLateSubmission, projectWindowState, STATE_LABELS, type DashboardItem, type Profile } from "@/lib/member-domain";
import { validateMarkdownUpload, validateSubmissionDraft, type SubmissionDraft } from "@/lib/submission-upload";
import styles from "@/styles/member.module.css";

type Ready = { item: DashboardItem; team: TeamContext | null };
type View = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: Ready };

const emptyDraft: SubmissionDraft = {
  summary: "",
  code_repository_url: "",
  report_filename: "",
  report_markdown: "",
};

function publishedReportUrl(item: DashboardItem): string | null {
  const submission = item.submission;
  if (!submission?.report_repository_url || !submission.report_path || !submission.submitted_ref) return null;
  const ref = encodeURIComponent(submission.submitted_ref);
  const path = submission.report_path.split("/").map(encodeURIComponent).join("/");
  return `${submission.report_repository_url.replace(/\/$/, "")}/blob/${ref}/${path}`;
}

function SubmissionForm({ profile }: { profile: Profile }) {
  const { client } = useMemberSession();
  const params = useSearchParams();
  const router = useRouter();
  const assignmentId = params.get("assignment") ?? "";
  const [view, setView] = useState<View>({ status: "loading" });
  const [draft, setDraft] = useState<SubmissionDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    if (!client || !assignmentId) return;
    setView({ status: "loading" });
    try {
      const dashboard = await readMemberDashboard(client, profile);
      const item = dashboard.items.find((candidate) => candidate.assignment.id === assignmentId);
      if (!item) throw new Error("제출 항목을 찾을 수 없습니다.");
      const team = item.assignment.project_type === "team" ? dashboard.team : null;
      setView({ status: "ready", data: { item, team } });
      setDraft(item.submission ? {
        summary: item.submission.summary,
        code_repository_url: item.submission.code_repository_url ?? "",
        report_filename: item.submission.report_filename ?? "",
        report_markdown: item.submission.report_markdown ?? "",
      } : emptyDraft);
    } catch (error) {
      setView({ status: "error", message: error instanceof Error ? error.message : "제출 정보를 불러오지 못했습니다." });
    }
  };

  useEffect(() => { void load(); }, [client, profile, assignmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const readonly = view.status === "ready" && view.data.item.state === "approved";
  const projectWindow = view.status === "ready" ? projectWindowState(view.data.item.assignment) : "upcoming";
  const beforeOpen = projectWindow === "upcoming";
  const late = view.status === "ready" && view.data.item.submission
    ? isLateSubmission(view.data.item.submission, view.data.item.assignment)
    : false;
  const locked = readonly || beforeOpen;
  const update = (key: "summary" | "code_repository_url", value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const reportValidation = draft.report_filename && draft.report_markdown
    ? validateMarkdownUpload(draft.report_filename, draft.report_markdown)
    : null;
  const reportBytes = reportValidation?.ok ? reportValidation.bytes : view.status === "ready" ? view.data.item.submission?.report_bytes ?? null : null;
  const projectDbUrl = view.status === "ready" ? publishedReportUrl(view.data.item) : null;

  const selectReport = async (file: File | undefined) => {
    if (!file) return;
    setReadingFile(true);
    setMessage(null);
    try {
      const markdown = await file.text();
      const validation = validateMarkdownUpload(file.name, markdown);
      if (!validation.ok) {
        setMessage(validation.message);
        return;
      }
      setDraft((current) => ({ ...current, report_filename: validation.filename, report_markdown: markdown }));
      setMessage(`${validation.filename} 파일을 선택했습니다.`);
    } catch {
      setMessage("Markdown 파일을 읽지 못했습니다. UTF-8 텍스트 파일인지 확인해 주세요.");
    } finally {
      setReadingFile(false);
    }
  };

  const submit = async () => {
    if (!client || view.status !== "ready") return;
    const item = view.data.item;
    if (projectWindowState(item.assignment) === "upcoming") {
      setMessage(`제출 시작 전입니다. ${formatDeadline(item.assignment.opens_at)}부터 제출할 수 있습니다.`);
      return;
    }
    const validation = validateSubmissionDraft(draft);
    if (!validation.ok) { setMessage(validation.message); return; }
    if (item.assignment.project_type === "team" && !view.data.team?.team) {
      setMessage("팀 미배정 — 운영진에게 문의해 주세요.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveSubmission(client, {
        ...draft,
        assignment_id: item.assignment.id,
        expected_version: item.submission?.version,
      });
      setMessage("제출했습니다. 제출 현황으로 이동합니다.");
      router.push("/member");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "제출하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return <main className={styles.page}>
    <MemberToolbar profile={profile} />
    <p className={styles.eyebrow}>ASC PROJECT SUBMISSION</p>
    <h1 className={styles.title}>{view.status === "ready" ? view.data.item.assignment.title : "프로젝트 제출"}</h1>
    <p className={styles.description}>Markdown 보고서를 올리면 운영진 승인 후 ProjectDB에 자동 반영됩니다.</p>

    {view.status === "loading" && <p className={styles.notice} role="status">제출 정보를 불러오고 있습니다.</p>}
    {view.status === "error" && <section className={styles.notice} role="alert"><p>{view.message}</p><Link className={styles.textLink} href="/member">돌아가기</Link></section>}
    {view.status === "ready" && <section className={styles.formCard}>
      <div className={styles.formHeader}>
        <div className={styles.actions}>
          <span className={styles.badge} data-state={view.data.item.state}>{STATE_LABELS[view.data.item.state]}</span>
          {late && <span className={styles.lateBadge}>지각</span>}
        </div>
        {readonly && <p className={styles.helper}>승인된 제출물은 읽기 전용입니다. 다시 제출하려면 운영진이 수정요청 상태로 열어야 합니다.</p>}
      </div>
      <p className={styles.helper}>제출 시작 {formatDeadline(view.data.item.assignment.opens_at)} · 마감 {formatDeadline(view.data.item.assignment.due_at)}</p>
      {beforeOpen && <p className={styles.notice}>제출 시작 전입니다. 시작 시간이 되면 제출할 수 있습니다.</p>}
      {projectWindow === "overdue" && !view.data.item.submission && <p className={styles.notice}>마감이 지났습니다. 지금 제출하면 지각 제출로 기록됩니다.</p>}

      <div className={styles.reviewNote}><strong>프로젝트명</strong><p>{view.data.item.assignment.title}</p></div>
      <label className={styles.field}>간단한 설명 <span className={styles.secondary}>선택</span>
        <textarea value={draft.summary} disabled={locked} onChange={(event) => update("summary", event.target.value)} maxLength={4000} rows={4} />
      </label>
      <label className={styles.field}>보고서 · Markdown (.md)
        <input
          type="file"
          accept=".md,text/markdown,text/plain"
          disabled={locked || readingFile}
          onChange={(event) => void selectReport(event.target.files?.[0])}
        />
        <span className={styles.helper}>YAML frontmatter는 작성하지 않아도 됩니다. ASC_WEB이 승인 시 자동 생성합니다. 최대 256 KiB.</span>
      </label>
      {draft.report_filename && <div className={styles.reviewNote}>
        <strong>선택한 보고서</strong>
        <p>{draft.report_filename}{reportBytes ? ` · ${reportBytes.toLocaleString("ko-KR")} bytes` : ""}</p>
      </div>}
      <label className={styles.field}>코드 GitHub 저장소 <span className={styles.secondary}>선택</span>
        <input value={draft.code_repository_url} disabled={locked} onChange={(event) => update("code_repository_url", event.target.value)} placeholder="https://github.com/owner/repo" />
      </label>

      {view.data.item.assignment.project_type === "team" && view.data.team && <section className={styles.teamBox}>
        <h2>팀 구성</h2>
        {view.data.team.team ? <>
          <p><strong>{view.data.team.team.name}</strong> · 확정된 팀 구성</p>
          <div className={styles.memberChips}>{view.data.team.members.map((member) => <span key={member.profile_id}>{member.name} · {member.member_id}</span>)}</div>
        </> : <p className={styles.notice}>팀 미배정 — 운영진에게 문의해 주세요.</p>}
      </section>}

      {view.data.item.submission?.review_note && <div className={styles.reviewNote}><strong>운영진 메모</strong><p>{view.data.item.submission.review_note}</p></div>}
      {projectDbUrl && <a className={styles.textLink} href={projectDbUrl} target="_blank" rel="noopener noreferrer">승인된 ProjectDB 보고서 열기 ↗</a>}
      {message && <p className={styles.notice} role="status">{message}</p>}
      <div className={styles.actions}>
        {!readonly && <button className={styles.button} type="button" onClick={() => void submit()} disabled={saving || readingFile || beforeOpen}>{saving ? "저장 중…" : view.data.item.submission ? "수정 제출" : projectWindow === "overdue" ? "지각 제출" : "제출하기"}</button>}
        <Link className={styles.textLink} href="/member">내 프로젝트로</Link>
      </div>
    </section>}
  </main>;
}

function SubmissionInner() {
  const { state } = useMemberSession();
  return <MemberGate>{state.status === "ready" && <SubmissionForm profile={state.profile} />}</MemberGate>;
}

export default function SubmissionPage() {
  return <Suspense fallback={<main className={styles.page}><p className={styles.notice}>제출 화면을 준비하고 있습니다.</p></main>}><SubmissionInner /></Suspense>;
}
