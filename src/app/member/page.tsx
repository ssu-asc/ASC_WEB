"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MemberGate, useMemberSession } from "@/component/member/MemberSession";
import { MemberToolbar } from "@/component/member/MemberToolbar";
import { readMemberDashboard, type MemberDashboard, type TeamContext } from "@/lib/member-api";
import {
  formatDeadline,
  groupDashboardItems,
  isActiveStaff,
  isLateSubmission,
  projectWindowState,
  STATE_LABELS,
  type DashboardItem,
  type Profile,
} from "@/lib/member-domain";
import styles from "@/styles/member.module.css";

type View = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: MemberDashboard };

function ProjectCard({ item, team, upcoming = false }: { item: DashboardItem; team: TeamContext | null; upcoming?: boolean }) {
  const window = projectWindowState(item.assignment);
  const late = item.submission ? isLateSubmission(item.submission, item.assignment) : false;
  const projectLabel = item.assignment.project_type === "individual" ? "개인 프로젝트" : "팀 프로젝트";
  const canOpen = !upcoming && item.state !== "not_assigned" && item.state !== "not_required";
  const actionLabel = item.state === "approved"
    ? "확인하기"
    : item.state === "not_submitted"
      ? window === "overdue" ? "지각 제출" : "제출하기"
      : "수정하기";
  return <article className={styles.card}>
    <div className={styles.actions}>
      <span className={styles.scheduleCategory}>{projectLabel}</span>
      <span className={styles.badge} data-state={item.state}>{STATE_LABELS[item.state]}</span>
      {late && <span className={styles.lateBadge}>지각</span>}
    </div>
    <h2>{item.assignment.title}</h2>
    {item.assignment.description && <p>{item.assignment.description}</p>}
    <dl className={styles.deadline}>
      <dt>제출 기간 · 한국시간</dt>
      <dd>{formatDeadline(item.assignment.opens_at)} → {formatDeadline(item.assignment.due_at)}</dd>
    </dl>
    {item.assignment.project_type === "team" && team?.team && <p><strong>{team.team.name}</strong> · {team.members.map((member) => member.name).join(", ")}</p>}
    {item.state === "not_assigned" && <p>팀 미배정 — 운영진에게 문의해 주세요.</p>}
    {item.submission?.review_note && <div className={styles.reviewNote}><strong>운영진 메모</strong><p>{item.submission.review_note}</p></div>}
    {upcoming && <p className={styles.helper}>제출 시작 전입니다.</p>}
    {canOpen && <Link className={styles.buttonLink} href={`/member/submission?assignment=${encodeURIComponent(item.assignment.id)}`}>{actionLabel}</Link>}
  </article>;
}

function ProjectSection({ title, items, team, empty, upcoming = false }: { title: string; items: DashboardItem[]; team: TeamContext | null; empty: string; upcoming?: boolean }) {
  return <section className={styles.scheduleSection}>
    <h2>{title}</h2>
    {items.length === 0 ? <p className={styles.helper}>{empty}</p> : <div className={styles.cards}>{items.map((item) => <ProjectCard key={item.assignment.id} item={item} team={team} upcoming={upcoming} />)}</div>}
  </section>;
}

function Dashboard({ profile }: { profile: Profile }) {
  const { client } = useMemberSession();
  const [view, setView] = useState<View>({ status: "loading" });
  const [revision, retry] = useState(0);
  useEffect(() => {
    if (!client) return;
    let alive = true;
    setView({ status: "loading" });
    void readMemberDashboard(client, profile).then((data) => {
      if (alive) setView({ status: "ready", data });
    }).catch((error: unknown) => {
      if (alive) setView({ status: "error", message: error instanceof Error ? error.message : "프로젝트 현황을 확인하지 못했습니다." });
    });
    return () => { alive = false; };
  }, [client, profile, revision]);

  const groups = useMemo(() => view.status === "ready" ? groupDashboardItems(view.data.items) : { current: [], upcoming: [], history: [] }, [view]);

  return <main className={styles.page}>
    <MemberToolbar profile={profile} />
    <p className={styles.eyebrow}>ASC PROJECT</p>
    <h1 className={styles.title}>{view.status === "ready" && view.data.semester ? `${view.data.semester.id} 내 프로젝트` : "내 프로젝트"}</h1>
    <p className={styles.description}>현재 해야 할 회차와 다음 일정을 먼저 확인할 수 있습니다.</p>
    {view.status === "loading" && <p className={styles.notice} role="status">프로젝트 현황을 불러오고 있습니다.</p>}
    {view.status === "error" && <section className={styles.notice} role="alert"><p>{view.message}</p><div className={styles.actions}><button className={styles.button} onClick={() => retry((value) => value + 1)}>다시 불러오기</button></div></section>}
    {view.status === "ready" && <>
      {!view.data.semester || !view.data.membership?.active ? <p className={styles.notice}>현재 학기 활동명단에 등록되어 있지 않습니다. 운영진에게 확인해 주세요.</p> : <>
        <ProjectSection title="지금 할 프로젝트" items={groups.current} team={view.data.team} empty="현재 제출하거나 수정할 프로젝트가 없습니다." />
        <ProjectSection title="다음 프로젝트" items={groups.upcoming} team={view.data.team} empty="예정된 다음 프로젝트가 없습니다." upcoming />
        <ProjectSection title="지난 프로젝트" items={groups.history} team={view.data.team} empty="완료된 프로젝트가 없습니다." />
      </>}
      <p className={styles.helper}>보고서는 ProjectDB의 Markdown 파일과 검토할 commit/tag를 기준으로 제출합니다.</p>
    </>}
  </main>;
}

function StaffRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/member/operations/progress"); }, [router]);
  return <main className={styles.page}><p className={styles.notice}>프로젝트 현황으로 이동하고 있습니다.</p></main>;
}

export default function MemberPage() {
  const { state } = useMemberSession();
  return <MemberGate>{state.status === "ready" && (isActiveStaff(state.profile) ? <StaffRedirect /> : <Dashboard profile={state.profile} />)}</MemberGate>;
}
