"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { MemberGate, useMemberSession } from "@/component/member/MemberSession";
import { MemberToolbar } from "@/component/member/MemberToolbar";
import { readMemberDashboard, saveSubmission, type TeamContext } from "@/lib/member-api";
import { formatDeadline, isLateSubmission, projectWindowState, STATE_LABELS, type DashboardItem, type Profile } from "@/lib/member-domain";
import { buildProjectReportTemplate, stripProjectDbFrontmatter } from "@/lib/project-report-template";
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
  const [templateMarkdown, setTemplateMarkdown] = useState("");
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
      const template = buildProjectReportTemplate({
        projectName: item.assignment.title,
        projectType: item.assignment.project_type,
        opensAt: item.assignment.opens_at,
        dueAt: item.assignment.due_at,
        individual: { member_id: profile.member_id, name: profile.name },
        team: team?.team ? {
          name: team.team.name,
          members: team.members.map((member) => ({ member_id: member.member_id, name: member.name })),
        } : null,
      });
      setTemplateMarkdown(template);
      setView({ status: "ready", data: { item, team } });
      setDraft(item.submission ? {
        summary: item.submission.summary,
        code_repository_url: item.submission.code_repository_url ?? "",
        report_filename: item.submission.report_filename ?? "report.md",
        report_markdown: item.submission.report_markdown ?? template,
      } : { ...emptyDraft, report_filename: "report.md", report_markdown: template });
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
  const updateReport = (value: string) => setDraft((current) => ({
    ...current,
    report_filename: current.report_filename || "report.md",
    report_markdown: value,
  }));
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
      const source = await file.text();
      const stripped = stripProjectDbFrontmatter(source);
      const markdown = stripped.markdown;
      const validation = validateMarkdownUpload(file.name, markdown);
      if (!validation.ok) {
        setMessage(validation.message);
        return;
      }
      setDraft((current) => ({ ...current, report_filename: validation.filename, report_markdown: markdown }));
      setMessage(stripped.stripped
        ? `${validation.filename}을 불러왔습니다. ProjectDB frontmatter는 ASC_WEB이 다시 생성하므로 자동으로 제거했습니다.`
        : `${validation.filename}을 불러왔습니다.`);
    } catch {
      setMessage("Markdown 파일을 읽지 못했습니다. UTF-8 텍스트 파일인지 확인해 주세요.");
    } finally {
      setReadingFile(false);
    }
  };

  const applyTemplate = () => {
    if (locked || !templateMarkdown) return;
    const hasMeaningfulDraft = draft.report_markdown.trim() && draft.report_markdown !== templateMarkdown;
    if (hasMeaningfulDraft && !window.confirm("현재 작성 중인 보고서를 ProjectDB 템플릿으로 바꿀까요? 작성 내용은 사라집니다.")) return;
    setDraft((current) => ({ ...current, report_filename: "report.md", report_markdown: templateMarkdown }));
    setMessage("ProjectDB 진행 보고서 템플릿을 적용했습니다.");
  };

  const downloadTemplate = () => {
    if (!templateMarkdown) return;
    const blob = new Blob([templateMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "report-template.md";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
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
    <p className={styles.description}>GitHub에서 파일을 만들 필요 없이 여기서 ProjectDB 템플릿에 맞춰 작성하고 바로 제출할 수 있습니다.</p>

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

      <section className={styles.reportComposer}>
        <div className={styles.reportComposerHeader}>
          <div>
            <span className={styles.scheduleCategory}>ProjectDB 템플릿</span>
            <h2>보고서 작성</h2>
            <p className={styles.helper}>프로젝트명, 제출자/팀, 활동 기간은 자동으로 채웠습니다. 아래 템플릿의 빈 부분만 작성하면 됩니다.</p>
          </div>
          <div className={styles.actions}>
            {!readonly && <button className={styles.smallButton} type="button" disabled={locked} onClick={applyTemplate}>템플릿 다시 적용</button>}
            <button className={styles.smallButton} type="button" onClick={downloadTemplate}>템플릿 다운로드</button>
            {!readonly && <label className={styles.smallButton} aria-disabled={locked || readingFile}>
              {readingFile ? "불러오는 중…" : "기존 .md 불러오기"}
              <input
                className={styles.srOnly}
                type="file"
                accept=".md,text/markdown,text/plain"
                disabled={locked || readingFile}
                onChange={(event) => void selectReport(event.target.files?.[0])}
              />
            </label>}
          </div>
        </div>
        <textarea
          className={styles.markdownEditor}
          aria-label="프로젝트 보고서 Markdown 편집기"
          value={draft.report_markdown}
          disabled={locked}
          onChange={(event) => updateReport(event.target.value)}
          rows={28}
          spellCheck={false}
        />
        <div className={styles.reportMeta}>
          <span>{draft.report_filename || "report.md"}</span>
          <span>{reportBytes ? `${reportBytes.toLocaleString("ko-KR")} bytes` : "작성 내용을 확인해 주세요"} · 최대 256 KiB</span>
        </div>
        <p className={styles.helper}>YAML frontmatter, ProjectDB 경로, commit SHA는 작성하지 않아도 됩니다. 승인 시 ASC_WEB이 회원/팀 정보로 안전하게 자동 생성합니다.</p>
      </section>

      <details className={styles.optionalDetails}>
        <summary>추가 정보 <span>선택</span></summary>
        <div className={styles.optionalDetailsBody}>
          <label className={styles.field}>운영진에게 남길 간단한 설명 <span className={styles.secondary}>선택</span>
            <textarea value={draft.summary} disabled={locked} onChange={(event) => update("summary", event.target.value)} maxLength={4000} rows={3} />
          </label>
          <label className={styles.field}>코드 GitHub 저장소 <span className={styles.secondary}>선택</span>
            <input value={draft.code_repository_url} disabled={locked} onChange={(event) => update("code_repository_url", event.target.value)} placeholder="https://github.com/owner/repo" />
          </label>
        </div>
      </details>

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
