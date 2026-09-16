"use client";

import { useEffect, useMemo, useState } from "react";
import { MemberGate, useMemberSession } from "@/component/member/MemberSession";
import { MemberToolbar } from "@/component/member/MemberToolbar";
import { readMemberResources, type ResourceCategory, type ResourceLink, type ResourceService } from "@/lib/member-api";
import type { Profile, Semester } from "@/lib/member-domain";
import styles from "@/styles/member.module.css";

type View =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; semester: Semester | null; links: ResourceLink[] };

type Filter = "all" | "study" | "project" | "ctf" | "other";

const FILTER_LABELS: Record<Filter, string> = {
  all: "전체",
  study: "스터디",
  project: "프로젝트",
  ctf: "CTF",
  other: "기타",
};

const SERVICE_LABELS: Record<ResourceService, string> = {
  notion: "Notion",
  google_drive: "Google Drive",
  google_docs: "Google Docs",
  google_sheets: "Google Sheets",
  google_forms: "Google Forms",
  github: "GitHub",
  discord: "Discord",
  other: "기타",
};

function hubCategory(category: ResourceCategory): Exclude<Filter, "all"> {
  if (category === "study" || category === "project" || category === "ctf") return category;
  return "other";
}

function MemberResourcesView({ profile }: { profile: Profile }) {
  const { client } = useMemberSession();
  const [view, setView] = useState<View>({ status: "loading" });
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (!client) return;
    let alive = true;
    setView({ status: "loading" });
    void readMemberResources(client, profile)
      .then((result) => { if (alive) setView({ status: "ready", ...result }); })
      .catch((error: unknown) => {
        if (alive) setView({ status: "error", message: error instanceof Error ? error.message : "자료실을 불러오지 못했습니다." });
      });
    return () => { alive = false; };
  }, [client, profile]);

  const visible = useMemo(() => {
    if (view.status !== "ready" || filter === "all") return view.status === "ready" ? view.links : [];
    return view.links.filter((link) => hubCategory(link.category) === filter);
  }, [view, filter]);

  return <main className={styles.page}>
    <MemberToolbar profile={profile} />
    <p className={styles.eyebrow}>ASC RESOURCES</p>
    <div className={styles.headingRow}>
      <div>
        <h1 className={styles.title}>ASC 자료실</h1>
        <p className={styles.description}>스터디, 프로젝트, CTF와 공용 도구 링크를 한 곳에서 확인합니다. 자료 원본은 Notion·Drive·GitHub·Discord 등 기존 서비스에 그대로 유지됩니다.</p>
      </div>
    </div>

    {view.status === "loading" && <p className={styles.notice}>자료실을 불러오고 있습니다.</p>}
    {view.status === "error" && <p className={styles.notice} role="alert">{view.message}</p>}
    {view.status === "ready" && <>
      <div className={styles.actions} aria-label="자료 분류">
        {(Object.entries(FILTER_LABELS) as Array<[Filter, string]>).map(([value, label]) => <button
          key={value}
          className={styles.smallButton}
          type="button"
          aria-pressed={filter === value}
          onClick={() => setFilter(value)}
        >{label}</button>)}
      </div>

      {view.semester && <p className={styles.helper}>{view.semester.title} · 회원 공개 자료 {view.links.length}개</p>}

      {visible.length === 0 ? <p className={styles.notice}>{view.links.length === 0 ? "등록된 회원 공개 자료가 없습니다." : "이 분류에 등록된 자료가 없습니다."}</p> : <section className={styles.scheduleSection}>
        <div className={styles.scheduleList}>{visible.map((link) => <article key={link.id}>
          <div>
            <div className={styles.actions}>
              <span className={styles.scheduleCategory}>{SERVICE_LABELS[link.service]}</span>
              <span className={styles.scheduleCategory}>{FILTER_LABELS[hubCategory(link.category)]}</span>
            </div>
            <strong>{link.title}</strong>
            {link.description && <p>{link.description}</p>}
          </div>
          <a className={styles.textLink} href={link.url} target="_blank" rel="noopener noreferrer">열기 ↗</a>
        </article>)}</div>
      </section>}

      <p className={styles.helper}>ASC 로그인은 링크를 찾는 범위를 제한합니다. 실제 문서 접근 권한은 Notion, Google Drive, GitHub, Discord 등 각 서비스의 공유 설정을 따릅니다.</p>
    </>}
  </main>;
}

export default function MemberResourcesPage() {
  const { state } = useMemberSession();
  return <MemberGate>{state.status === "ready" && <MemberResourcesView profile={state.profile} />}</MemberGate>;
}
