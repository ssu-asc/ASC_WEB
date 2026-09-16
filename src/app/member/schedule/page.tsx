"use client";

import { useEffect, useMemo, useState } from "react";
import { MemberGate, useMemberSession } from "@/component/member/MemberSession";
import { MemberToolbar } from "@/component/member/MemberToolbar";
import {
  deactivateAssignment,
  deleteEvent,
  readSchedule,
  saveAssignment,
  saveAssignmentSeries,
  saveEvent,
  type AssignmentDraft,
  type AssignmentSeriesDraft,
  type ScheduleData,
} from "@/lib/member-api";
import {
  calendarDateForScheduleItem,
  generateAlternatingRounds,
  isActiveStaff,
  validateEventDraft,
  type Assignment,
  type EventCategory,
  type EventDraft,
  type Profile,
  type ProjectType,
  type ScheduleEvent,
  type ScheduleItem,
} from "@/lib/member-domain";
import styles from "@/styles/member.module.css";

type View = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: ScheduleData };
type EditorMode = "event" | "individual" | "team" | "alternating";
type Editing = { kind: "event"; event: ScheduleEvent } | { kind: "assignment"; assignment: Assignment } | null;

const categoryLabels: Record<EventCategory, string> = {
  project: "프로젝트(일반)", seminar: "세미나", ctf: "CTF", meeting: "회의", presentation: "발표", other: "기타",
};
const generalCategories: EventCategory[] = ["seminar", "ctf", "meeting", "presentation", "other"];

function localInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.valueOf())) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}
function inputToIso(value: string): string {
  if (!value) throw new Error("시간을 입력해 주세요.");
  const date = new Date(`${value}:00+09:00`);
  if (!Number.isFinite(date.valueOf())) throw new Error("시간을 확인해 주세요.");
  return date.toISOString();
}
function displayDate(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
function dateKey(value: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
function monthKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function monthCells(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => { const value = new Date(start); value.setDate(start.getDate() + index); return value; });
}
function itemLabel(item: ScheduleItem): string {
  if (item.source === "assignment") return item.project_type === "individual" ? "개인 프로젝트" : "팀 프로젝트";
  return categoryLabels[item.category];
}

function ScheduleView({ profile }: { profile: Profile }) {
  const { client } = useMemberSession();
  const [view, setView] = useState<View>({ status: "loading" });
  const [revision, reload] = useState(0);
  const [month, setMonth] = useState(() => new Date());
  const [editing, setEditing] = useState<Editing>(null);
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<EditorMode>("event");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<EventCategory>("other");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [link, setLink] = useState("");
  const [firstType, setFirstType] = useState<ProjectType>("individual");
  const [intervalWeeks, setIntervalWeeks] = useState(1);
  const [count, setCount] = useState(8);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const staff = isActiveStaff(profile);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    setView({ status: "loading" });
    void readSchedule(client).then((data) => { if (alive) setView({ status: "ready", data }); })
      .catch((error: unknown) => { if (alive) setView({ status: "error", message: error instanceof Error ? error.message : "일정을 불러오지 못했습니다." }); });
    return () => { alive = false; };
  }, [client, revision]);

  const items = view.status === "ready" ? view.data.items : [];
  const upcoming = useMemo(() => {
    const now = Date.now();
    return items.filter((item) => new Date(item.end_at ?? item.start_at).valueOf() >= now).slice(0, 6);
  }, [items]);
  const cells = useMemo(() => monthCells(month), [month]);
  const byDate = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    for (const item of items) {
      const key = dateKey(calendarDateForScheduleItem(item));
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [items]);

  const resetEditor = () => {
    setEditing(null); setMode("event"); setTitle(""); setCategory("other"); setDescription("");
    setStart(""); setEnd(""); setLink(""); setFirstType("individual"); setIntervalWeeks(1); setCount(8); setMessage(null);
  };
  const openNew = () => { resetEditor(); setShowForm(true); };
  const openEditEvent = (event: ScheduleEvent) => {
    setEditing({ kind: "event", event }); setMode("event"); setTitle(event.title); setCategory(event.category);
    setDescription(event.description); setStart(localInput(event.start_at)); setEnd(localInput(event.end_at)); setLink(event.link_url ?? "");
    setMessage(null); setShowForm(true);
  };
  const openEditAssignment = (assignment: Assignment) => {
    setEditing({ kind: "assignment", assignment }); setMode(assignment.project_type); setTitle(assignment.title);
    setDescription(assignment.description); setStart(localInput(assignment.opens_at)); setEnd(localInput(assignment.due_at)); setLink("");
    setMessage(null); setShowForm(true);
  };

  const seriesPreview = useMemo(() => {
    if (mode !== "alternating" || !start || !end || !title.trim()) return [];
    try {
      return generateAlternatingRounds({
        firstOpensAt: inputToIso(start), firstDueAt: inputToIso(end), intervalWeeks, count,
        firstType, titlePrefix: title, description,
      });
    } catch { return []; }
  }, [mode, start, end, intervalWeeks, count, firstType, title, description]);

  const persist = async () => {
    if (!client || view.status !== "ready" || !view.data.semester) return;
    setBusy(true); setMessage(null);
    try {
      if (mode === "event") {
        const eventDraft: EventDraft = {
          title, category, description, start_at: inputToIso(start), end_at: end ? inputToIso(end) : null, link_url: link.trim() || null,
        };
        const validation = validateEventDraft(eventDraft);
        if (!validation.ok) throw new Error(validation.message);
        await saveEvent(client, profile, view.data.semester.id, eventDraft, editing?.kind === "event" ? editing.event : undefined);
      } else if (mode === "alternating") {
        if (editing) throw new Error("반복 생성은 새 일정에서만 사용할 수 있습니다.");
        if (seriesPreview.length !== count) throw new Error("반복 프로젝트 설정을 확인해 주세요.");
        const series: AssignmentSeriesDraft = {
          first_type: firstType, title_prefix: title.trim(), description,
          first_opens_at: inputToIso(start), first_due_at: inputToIso(end), interval_weeks: intervalWeeks, count,
        };
        await saveAssignmentSeries(client, series);
      } else {
        const draft: AssignmentDraft = {
          project_type: mode, title: title.trim(), description, opens_at: inputToIso(start), due_at: inputToIso(end),
        };
        if (!draft.title) throw new Error("프로젝트 제목을 입력해 주세요.");
        if (new Date(draft.due_at).valueOf() <= new Date(draft.opens_at).valueOf()) throw new Error("마감 시간은 제출 시작 이후여야 합니다.");
        await saveAssignment(client, draft, editing?.kind === "assignment" ? editing.assignment : undefined);
      }
      setShowForm(false); resetEditor(); reload((value) => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "일정을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!client || !editing) return;
    const label = editing.kind === "event" ? editing.event.title : editing.assignment.title;
    if (!window.confirm(`'${label}' 일정을 삭제할까요?`)) return;
    setBusy(true); setMessage(null);
    try {
      if (editing.kind === "event") await deleteEvent(client, profile, editing.event);
      else await deactivateAssignment(client, editing.assignment);
      setShowForm(false); resetEditor(); reload((value) => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "일정을 삭제하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <main className={styles.page}>
    <MemberToolbar profile={profile} />
    <p className={styles.eyebrow}>ASC SCHEDULE</p>
    <div className={styles.headingRow}>
      <div><h1 className={styles.title}>{view.status === "ready" && view.data.semester ? `${view.data.semester.id} 일정` : "ASC 일정"}</h1><p className={styles.description}>프로젝트 제출 기간과 ASC 행사를 한 곳에서 관리합니다.</p></div>
      {staff && <button className={styles.button} onClick={openNew}>일정 추가</button>}
    </div>

    {view.status === "loading" && <p className={styles.notice}>일정을 불러오고 있습니다.</p>}
    {view.status === "error" && <section className={styles.notice} role="alert"><p>{view.message}</p><button className={styles.button} onClick={() => reload((value) => value + 1)}>다시 불러오기</button></section>}
    {view.status === "ready" && <>
      <section className={styles.scheduleSection}><h2>다가오는 일정</h2>{upcoming.length === 0 ? <p className={styles.helper}>다가오는 일정이 없습니다.</p> : <div className={styles.upcomingList}>{upcoming.map((item) => <article key={item.id}><span className={styles.scheduleCategory}>{itemLabel(item)}</span><div><strong>{item.title}</strong><p>{displayDate(item.start_at)}{item.end_at ? ` → ${displayDate(item.end_at)}` : ""}</p></div>{item.link_url && <a className={styles.textLink} href={item.link_url} target="_blank" rel="noopener noreferrer">링크 ↗</a>}</article>)}</div>}</section>

      <section className={styles.calendarCard}>
        <div className={styles.calendarHeader}><button className={styles.smallButton} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>이전</button><h2>{month.getFullYear()}년 {month.getMonth() + 1}월</h2><button className={styles.smallButton} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>다음</button></div>
        <div className={styles.weekHeader}>{["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className={styles.calendarGrid}>{cells.map((cell) => {
          const key = `${cell.getFullYear()}-${String(cell.getMonth() + 1).padStart(2, "0")}-${String(cell.getDate()).padStart(2, "0")}`;
          const dayItems = byDate.get(key) ?? [];
          return <div key={key} className={styles.calendarDay} data-muted={monthKey(cell) !== monthKey(month)}><span className={styles.dayNumber}>{cell.getDate()}</span>{dayItems.slice(0, 3).map((item) => {
            const calendarTitle = item.source === "assignment" ? `${item.title} 마감` : item.title;
            return <span key={item.id} className={styles.calendarEvent} title={`${itemLabel(item)} · ${calendarTitle}`}>{calendarTitle}</span>;
          })}{dayItems.length > 3 && <span className={styles.moreEvents}>+{dayItems.length - 3}</span>}</div>;
        })}</div>
      </section>

      <section className={styles.scheduleSection}><h2>전체 일정</h2><div className={styles.scheduleList}>{items.map((item) => <article key={item.id}>
        <div><span className={styles.scheduleCategory}>{itemLabel(item)}</span><strong>{item.title}</strong><p>{displayDate(item.start_at)}{item.end_at ? ` → ${displayDate(item.end_at)}` : ""}</p>{item.description && <p>{item.description}</p>}</div>
        <div className={styles.actions}>{item.link_url && <a className={styles.textLink} href={item.link_url} target="_blank" rel="noopener noreferrer">링크 ↗</a>}{staff && item.source === "event" && <button className={styles.smallButton} onClick={() => openEditEvent(view.data.events.find((event) => event.id === item.id)!)}>수정</button>}{staff && item.source === "assignment" && <button className={styles.smallButton} onClick={() => openEditAssignment(view.data.assignments.find((assignment) => `assignment:${assignment.id}` === item.id)!)}>수정</button>}</div>
      </article>)}</div>{items.length === 0 && <p className={styles.notice}>등록된 일정이 없습니다.</p>}</section>
    </>}

    {staff && showForm && <div className={styles.modalBackdrop} role="presentation"><section className={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby="schedule-form-title">
      <div className={styles.headingRow}><h2 id="schedule-form-title">{editing ? "일정 수정" : "일정 추가"}</h2><button className={styles.smallButton} onClick={() => setShowForm(false)}>닫기</button></div>
      {!editing && <label className={styles.field}>종류<select value={mode} onChange={(event) => setMode(event.target.value as EditorMode)}><option value="event">일반 일정</option><option value="individual">개인 프로젝트</option><option value="team">팀 프로젝트</option><option value="alternating">개인 ↔ 팀 반복</option></select></label>}

      {mode === "event" ? <div className={styles.formGrid}>
        <label className={styles.field}>제목<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className={styles.field}>분류<select value={category} onChange={(event) => setCategory(event.target.value as EventCategory)}>{(editing?.kind === "event" && editing.event.category === "project" ? ["project" as EventCategory, ...generalCategories] : generalCategories).map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}</select></label>
        <label className={styles.field}>시작<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label className={styles.field}>종료 <span className={styles.secondary}>선택</span><input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        <label className={styles.field}>링크 <span className={styles.secondary}>선택</span><input value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://" /></label>
      </div> : <>
        <div className={styles.formGrid}>
          <label className={styles.field}>{mode === "alternating" ? "제목 접두어" : "프로젝트 제목"}<input value={title} maxLength={mode === "alternating" ? 120 : 160} onChange={(event) => setTitle(event.target.value)} placeholder={mode === "alternating" ? "예: ASC 프로젝트" : "예: 3회차 개인 프로젝트"} /></label>
          {mode === "alternating" && <label className={styles.field}>첫 회차<select value={firstType} onChange={(event) => setFirstType(event.target.value as ProjectType)}><option value="individual">개인 프로젝트</option><option value="team">팀 프로젝트</option></select></label>}
          <label className={styles.field}>제출 시작<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label className={styles.field}>마감<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
          {mode === "alternating" && <><label className={styles.field}>반복 간격 · 주<input type="number" min={1} max={8} value={intervalWeeks} onChange={(event) => setIntervalWeeks(Number(event.target.value))} /></label><label className={styles.field}>회차 수<input type="number" min={1} max={30} value={count} onChange={(event) => setCount(Number(event.target.value))} /></label></>}
        </div>
        {mode === "alternating" && <div className={styles.teamBox}><h2>생성 미리보기</h2>{seriesPreview.length === 0 ? <p className={styles.helper}>시간과 반복 설정을 입력하면 생성될 회차를 미리 볼 수 있습니다.</p> : <div className={styles.scheduleList}>{seriesPreview.map((round) => <article key={round.ordinal}><div><span className={styles.scheduleCategory}>{round.project_type === "individual" ? "개인" : "팀"}</span><strong>{round.title}</strong><p>{displayDate(round.opens_at)} → {displayDate(round.due_at)}</p></div></article>)}</div>}</div>}
      </>}
      <label className={styles.field}>설명<textarea rows={4} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      {message && <p className={styles.notice} role="status">{message}</p>}
      <div className={styles.actions}><button className={styles.button} disabled={busy} onClick={() => void persist()}>{busy ? "저장 중…" : mode === "alternating" ? `${count}개 회차 생성` : "저장"}</button>{editing && <button className={styles.dangerButton} disabled={busy} onClick={() => void remove()}>삭제</button>}</div>
    </section></div>}
  </main>;
}

export default function SchedulePage() {
  const { state } = useMemberSession();
  return <MemberGate>{state.status === "ready" && <ScheduleView profile={state.profile} />}</MemberGate>;
}
