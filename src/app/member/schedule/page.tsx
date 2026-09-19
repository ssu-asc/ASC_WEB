"use client";

import { useEffect, useMemo, useState } from "react";
import { MemberGate, useMemberSession } from "@/component/member/MemberSession";
import { MemberToolbar } from "@/component/member/MemberToolbar";
import {
  createScheduleSeries,
  deactivateAssignment,
  deactivateScheduleSeries,
  deleteEvent,
  readSchedule,
  saveAssignment,
  saveEvent,
  updateScheduleSeries,
  type ScheduleData,
  type ScheduleSeriesDraft,
} from "@/lib/member-api";
import {
  calendarDateForScheduleItem,
  isActiveStaff,
  validateEventDraft,
  type Assignment,
  type EventCategory,
  type EventDraft,
  type Profile,
  type ScheduleProjectPattern,
  type ScheduleRecurrenceEndMode,
  type ScheduleRecurrenceFrequency,
  type ScheduleEvent,
  type ScheduleItem,
  type ScheduleSeries,
} from "@/lib/member-domain";
import { generateScheduleOccurrences } from "../../../../shared/schedule-recurrence";
import styles from "@/styles/member.module.css";

type View = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: ScheduleData };
type EditorMode = "event" | "project";
type Editing =
  | { kind: "event"; event: ScheduleEvent }
  | { kind: "assignment"; assignment: Assignment }
  | { kind: "series"; series: ScheduleSeries }
  | null;

type BulkEditRow = {
  key: string;
  item: ScheduleItem;
  title: string;
  start: string;
  end: string;
};

const categoryLabels: Record<EventCategory, string> = {
  project: "프로젝트 제출", seminar: "세미나", ctf: "CTF", meeting: "회의", presentation: "발표", other: "기타",
};
const generalCategories: Array<Exclude<EventCategory, "project">> = ["seminar", "ctf", "meeting", "presentation", "other"];
const recurrenceLabels: Record<ScheduleRecurrenceFrequency, string> = {
  none: "반복 안 함", daily: "매일", weekly: "매주", monthly: "매월",
};
const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];

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

function kstWeekdayFromInput(value: string): number {
  if (!value) return 1;
  const ms = new Date(`${value}:00+09:00`).valueOf();
  if (!Number.isFinite(ms)) return 1;
  return new Date(ms + 9 * 60 * 60 * 1000).getUTCDay();
}

function recurrenceSummary(series: ScheduleSeries): string {
  if (series.recurrence_frequency === "none") return "1회";
  const interval = series.recurrence_interval === 1 ? recurrenceLabels[series.recurrence_frequency] : `매 ${series.recurrence_interval}${series.recurrence_frequency === "daily" ? "일" : series.recurrence_frequency === "weekly" ? "주" : "개월"}`;
  const weekdays = series.recurrence_frequency === "weekly" ? ` · ${series.weekdays.map((day) => weekdayLabels[day]).join("·")}` : "";
  const end = series.end_mode === "never" ? "계속" : series.end_mode === "count" ? `${series.occurrence_count}회` : `${series.until_at ? displayDate(series.until_at) : "종료일"}까지`;
  return `${interval}${weekdays} · ${end}`;
}

function shiftLocalInput(value: string, days: number): string {
  if (!value || !Number.isFinite(days) || days === 0) return value;
  const time = new Date(`${value}:00+09:00`).valueOf();
  if (!Number.isFinite(time)) return value;
  return localInput(new Date(time + days * 24 * 60 * 60 * 1000).toISOString());
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
  const [category, setCategory] = useState<Exclude<EventCategory, "project">>("other");
  const [projectPattern, setProjectPattern] = useState<ScheduleProjectPattern>("individual");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [link, setLink] = useState("");
  const [frequency, setFrequency] = useState<ScheduleRecurrenceFrequency>("none");
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [endMode, setEndMode] = useState<ScheduleRecurrenceEndMode>("count");
  const [occurrenceCount, setOccurrenceCount] = useState(8);
  const [until, setUntil] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkRows, setBulkRows] = useState<Record<string, BulkEditRow>>({});
  const [bulkSelected, setBulkSelected] = useState<string[]>([]);
  const [bulkShiftDays, setBulkShiftDays] = useState(0);
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
    return items.filter((item) => new Date(item.end_at ?? item.start_at).valueOf() >= now).slice(0, 8);
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
    setEditing(null); setMode("event"); setTitle(""); setCategory("other"); setProjectPattern("individual"); setDescription("");
    setStart(""); setEnd(""); setLink(""); setFrequency("none"); setRecurrenceInterval(1); setWeekdays([]);
    setEndMode("count"); setOccurrenceCount(8); setUntil(""); setMessage(null);
  };

  const openNew = () => { resetEditor(); setShowForm(true); };

  const openEditEvent = (event: ScheduleEvent) => {
    setEditing({ kind: "event", event }); setMode("event"); setTitle(event.title); setCategory(event.category === "project" ? "other" : event.category);
    setDescription(event.description); setStart(localInput(event.start_at)); setEnd(localInput(event.end_at)); setLink(event.link_url ?? "");
    setFrequency("none"); setRecurrenceInterval(1); setWeekdays([]); setEndMode("count"); setOccurrenceCount(1); setUntil("");
    setMessage(null); setShowForm(true);
  };

  const openEditAssignment = (assignment: Assignment) => {
    setEditing({ kind: "assignment", assignment }); setMode("project"); setTitle(assignment.title); setProjectPattern(assignment.project_type);
    setDescription(assignment.description); setStart(localInput(assignment.opens_at)); setEnd(localInput(assignment.due_at)); setLink("");
    setFrequency("none"); setRecurrenceInterval(1); setWeekdays([]); setEndMode("count"); setOccurrenceCount(1); setUntil("");
    setMessage(null); setShowForm(true);
  };

  const openEditSeries = (series: ScheduleSeries) => {
    setEditing({ kind: "series", series });
    setMode(series.kind);
    setTitle(series.title); setDescription(series.description); setLink(series.link_url ?? "");
    if (series.event_category) setCategory(series.event_category);
    if (series.project_pattern) setProjectPattern(series.project_pattern);
    setStart(localInput(series.first_start_at)); setEnd(localInput(series.first_end_at));
    setFrequency(series.recurrence_frequency); setRecurrenceInterval(series.recurrence_interval); setWeekdays(series.weekdays);
    setEndMode(series.end_mode); setOccurrenceCount(series.occurrence_count ?? 8); setUntil(localInput(series.until_at));
    setMessage(null); setShowForm(true);
  };

  const setRecurrenceFrequency = (value: ScheduleRecurrenceFrequency) => {
    setFrequency(value);
    if (value === "none") { setWeekdays([]); setEndMode("count"); setOccurrenceCount(1); }
    else if (value === "weekly" && weekdays.length === 0) setWeekdays([kstWeekdayFromInput(start)]);
  };

  const toggleWeekday = (day: number) => {
    setWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort((a, b) => a - b));
  };

  const buildSeriesDraft = (): ScheduleSeriesDraft => {
    if (!title.trim()) throw new Error("제목을 입력해 주세요.");
    const firstStart = inputToIso(start);
    const firstEnd = inputToIso(end);
    if (new Date(firstEnd).valueOf() <= new Date(firstStart).valueOf()) throw new Error(mode === "project" ? "마감 시간은 제출 시작 이후여야 합니다." : "종료 시간은 시작 이후여야 합니다.");
    return {
      kind: mode,
      title: title.trim(),
      description,
      event_category: mode === "event" ? category : null,
      project_pattern: mode === "project" ? projectPattern : null,
      link_url: mode === "event" ? link.trim() || null : null,
      first_start_at: firstStart,
      first_end_at: firstEnd,
      recurrence_frequency: frequency,
      recurrence_interval: frequency === "none" ? 1 : recurrenceInterval,
      weekdays: frequency === "weekly" ? weekdays : [],
      end_mode: frequency === "none" ? "count" : endMode,
      occurrence_count: frequency === "none" ? 1 : endMode === "count" ? occurrenceCount : null,
      until_at: frequency !== "none" && endMode === "until" ? inputToIso(until) : null,
    };
  };

  const seriesPreview = useMemo(() => {
    if (!start || !end || !title.trim()) return [];
    try {
      const draft = buildSeriesDraft();
      return generateScheduleOccurrences(draft, {
        horizon_at: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
        max_occurrences: 20,
      });
    } catch { return []; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, title, start, end, frequency, recurrenceInterval, weekdays, endMode, occurrenceCount, until, category, projectPattern, description, link]);

  const persist = async () => {
    if (!client || view.status !== "ready" || !view.data.semester) return;
    setBusy(true); setMessage(null);
    try {
      if (editing?.kind === "event") {
        const eventDraft: EventDraft = { title, category, description, start_at: inputToIso(start), end_at: end ? inputToIso(end) : null, link_url: link.trim() || null };
        const validation = validateEventDraft(eventDraft);
        if (!validation.ok) throw new Error(validation.message);
        await saveEvent(client, profile, view.data.semester.id, eventDraft, editing.event);
      } else if (editing?.kind === "assignment") {
        if (projectPattern === "alternating") throw new Error("기존 단일 프로젝트는 개인 또는 팀 프로젝트로만 수정할 수 있습니다.");
        await saveAssignment(client, {
          project_type: projectPattern,
          title: title.trim(), description,
          opens_at: inputToIso(start), due_at: inputToIso(end),
        }, editing.assignment);
      } else {
        const draft = buildSeriesDraft();
        if (editing?.kind === "series") await updateScheduleSeries(client, editing.series, draft);
        else await createScheduleSeries(client, draft);
      }
      setShowForm(false); resetEditor(); reload((value) => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "일정을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!client || !editing) return;
    const label = editing.kind === "event" ? editing.event.title : editing.kind === "assignment" ? editing.assignment.title : editing.series.title;
    const suffix = editing.kind === "series" ? " 반복 규칙과 아직 시작하지 않은 생성 일정" : " 일정";
    if (!window.confirm(`'${label}'${suffix}을 삭제할까요?`)) return;
    setBusy(true); setMessage(null);
    try {
      if (editing.kind === "event") await deleteEvent(client, profile, editing.event);
      else if (editing.kind === "assignment") await deactivateAssignment(client, editing.assignment);
      else await deactivateScheduleSeries(client, editing.series);
      setShowForm(false); resetEditor(); reload((value) => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "일정을 삭제하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const editItem = (item: ScheduleItem) => {
    if (view.status !== "ready") return;
    if (item.schedule_series_id) {
      const series = view.data.series.find((candidate) => candidate.id === item.schedule_series_id);
      if (series) { openEditSeries(series); return; }
    }
    if (item.source === "event") {
      const event = view.data.events.find((candidate) => candidate.id === item.id);
      if (event) openEditEvent(event);
    } else {
      const assignment = view.data.assignments.find((candidate) => `assignment:${candidate.id}` === item.id);
      if (assignment) openEditAssignment(assignment);
    }
  };

  const openBulkEdit = () => {
    const rows = Object.fromEntries(items.map((item) => [item.id, {
      key: item.id,
      item,
      title: item.title,
      start: localInput(item.start_at),
      end: localInput(item.end_at),
    } satisfies BulkEditRow]));
    setBulkRows(rows);
    setBulkSelected([]);
    setBulkShiftDays(0);
    setBulkMode(true);
    setMessage(null);
  };

  const closeBulkEdit = () => {
    setBulkMode(false);
    setBulkRows({});
    setBulkSelected([]);
    setBulkShiftDays(0);
  };

  const toggleBulkItem = (key: string) => {
    setBulkSelected((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
  };

  const toggleAllBulkItems = () => {
    setBulkSelected((current) => current.length === items.length ? [] : items.map((item) => item.id));
  };

  const updateBulkRow = (key: string, field: "title" | "start" | "end", value: string) => {
    setBulkRows((current) => ({ ...current, [key]: { ...current[key], [field]: value } }));
  };

  const shiftSelectedBulkRows = () => {
    if (!Number.isFinite(bulkShiftDays) || bulkShiftDays === 0 || bulkSelected.length === 0) return;
    const selected = new Set(bulkSelected);
    setBulkRows((current) => Object.fromEntries(Object.entries(current).map(([key, row]) => [key, selected.has(key) ? {
      ...row,
      start: shiftLocalInput(row.start, bulkShiftDays),
      end: shiftLocalInput(row.end, bulkShiftDays),
    } : row])));
  };

  const saveBulkRows = async () => {
    if (!client || view.status !== "ready" || !view.data.semester || bulkSelected.length === 0) return;
    setBusy(true); setMessage(null);
    let saved = 0;
    const failures: string[] = [];
    try {
      for (const key of bulkSelected) {
        const row = bulkRows[key];
        if (!row) continue;
        try {
          if (!row.title.trim()) throw new Error("제목이 비어 있습니다.");
          if (row.item.source === "event") {
            const event = view.data.events.find((candidate) => candidate.id === row.item.id);
            if (!event) throw new Error("일정 원본을 찾을 수 없습니다.");
            const draft: EventDraft = {
              title: row.title.trim(),
              category: event.category,
              description: event.description,
              start_at: inputToIso(row.start),
              end_at: row.end ? inputToIso(row.end) : null,
              link_url: event.link_url,
            };
            const validation = validateEventDraft(draft);
            if (!validation.ok) throw new Error(validation.message);
            await saveEvent(client, profile, view.data.semester.id, draft, event);
          } else {
            const assignment = view.data.assignments.find((candidate) => `assignment:${candidate.id}` === row.item.id);
            if (!assignment) throw new Error("프로젝트 회차 원본을 찾을 수 없습니다.");
            const opensAt = inputToIso(row.start);
            const dueAt = inputToIso(row.end);
            if (new Date(dueAt).valueOf() <= new Date(opensAt).valueOf()) throw new Error("마감은 제출 시작 이후여야 합니다.");
            await saveAssignment(client, {
              project_type: assignment.project_type,
              title: row.title.trim(),
              description: assignment.description,
              opens_at: opensAt,
              due_at: dueAt,
            }, assignment);
          }
          saved += 1;
        } catch (error) {
          failures.push(`${row.title}: ${error instanceof Error ? error.message : "저장 실패"}`);
        }
      }
      if (failures.length === 0) {
        closeBulkEdit();
        setMessage(`${saved}개 일정을 일괄 수정했습니다.`);
      } else {
        setMessage(`${saved}개 저장 · ${failures.length}개 실패 — ${failures.slice(0, 3).join(" / ")}`);
      }
      reload((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  const deleteBulkRows = async (deleteAll = false) => {
    if (!client || view.status !== "ready") return;
    const keys = deleteAll ? items.map((item) => item.id) : bulkSelected;
    const seriesIds = new Set<string>();
    if (deleteAll) {
      for (const series of view.data.series) seriesIds.add(series.id);
    }
    for (const key of keys) {
      const row = bulkRows[key] ?? { item: items.find((item) => item.id === key) };
      if (row?.item?.schedule_series_id) seriesIds.add(row.item.schedule_series_id);
    }
    if (keys.length === 0 && seriesIds.size === 0) return;

    const recurringNote = seriesIds.size > 0
      ? `\n\n반복 생성 일정 ${seriesIds.size}개 규칙도 함께 종료되어 이후 회차가 다시 생성되지 않습니다.`
      : "";
    const targetLabel = deleteAll ? `전체 일정 ${keys.length}개` : `선택한 일정 ${keys.length}개`;
    if (!window.confirm(`${targetLabel}을 삭제할까요?${recurringNote}\n\n제출 기록이 있는 프로젝트 회차는 보호되어 삭제되지 않습니다.`)) return;
    if (deleteAll && !window.confirm("전체 삭제는 되돌릴 수 없습니다. 정말 계속할까요?")) return;

    setBusy(true); setMessage(null);
    let deleted = 0;
    const failures: string[] = [];
    try {
      for (const key of keys) {
        const item = bulkRows[key]?.item ?? items.find((candidate) => candidate.id === key);
        if (!item) continue;
        try {
          if (item.source === "event") {
            const event = view.data.events.find((candidate) => candidate.id === item.id);
            if (!event) throw new Error("일정 원본을 찾을 수 없습니다.");
            await deleteEvent(client, profile, event);
          } else {
            const assignment = view.data.assignments.find((candidate) => `assignment:${candidate.id}` === item.id);
            if (!assignment) throw new Error("프로젝트 회차 원본을 찾을 수 없습니다.");
            await deactivateAssignment(client, assignment);
          }
          deleted += 1;
        } catch (error) {
          failures.push(`${item.title}: ${error instanceof Error ? error.message : "삭제 실패"}`);
        }
      }

      for (const seriesId of seriesIds) {
        const series = view.data.series.find((candidate) => candidate.id === seriesId);
        if (!series) continue;
        try {
          await deactivateScheduleSeries(client, series);
        } catch (error) {
          failures.push(`${series.title} 반복 규칙: ${error instanceof Error ? error.message : "종료 실패"}`);
        }
      }

      closeBulkEdit();
      const failureText = failures.length > 0 ? ` · ${failures.length}개 실패 — ${failures.slice(0, 3).join(" / ")}` : "";
      setMessage(`${deleted}개 일정을 삭제했습니다${failureText}`);
      reload((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  return <main className={styles.page}>
    <MemberToolbar profile={profile} />
    <p className={styles.eyebrow}>ASC SCHEDULE</p>
    <div className={styles.headingRow}>
      <div><h1 className={styles.title}>{view.status === "ready" && view.data.semester ? `${view.data.semester.id} 일정` : "ASC 일정"}</h1><p className={styles.description}>일반 일정과 프로젝트 제출창을 실제 캘린더처럼 반복 규칙과 함께 관리합니다.</p></div>
      {staff && <button className={styles.button} onClick={openNew}>일정 추가</button>}
    </div>

    {view.status === "loading" && <p className={styles.notice}>일정을 불러오고 있습니다.</p>}
    {view.status === "error" && <section className={styles.notice} role="alert"><p>{view.message}</p><button className={styles.button} onClick={() => reload((value) => value + 1)}>다시 불러오기</button></section>}
    {view.status === "ready" && <>
      <section className={styles.scheduleSection}><h2>다가오는 일정</h2>{upcoming.length === 0 ? <p className={styles.helper}>다가오는 일정이 없습니다.</p> : <div className={styles.upcomingList}>{upcoming.map((item) => <article key={item.id}><span className={styles.scheduleCategory}>{itemLabel(item)}</span><div><strong>{item.title}</strong><p>{displayDate(item.start_at)}{item.end_at ? ` → ${displayDate(item.end_at)}` : ""}</p></div>{item.link_url && <a className={styles.textLink} href={item.link_url} target="_blank" rel="noopener noreferrer">링크 ↗</a>}</article>)}</div>}</section>

      <section className={styles.calendarCard}>
        <div className={styles.calendarHeader}><button className={styles.smallButton} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>이전</button><h2>{month.getFullYear()}년 {month.getMonth() + 1}월</h2><button className={styles.smallButton} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>다음</button></div>
        <div className={styles.weekHeader}>{weekdayLabels.map((day) => <span key={day}>{day}</span>)}</div>
        <div className={styles.calendarGrid}>{cells.map((cell) => {
          const key = `${cell.getFullYear()}-${String(cell.getMonth() + 1).padStart(2, "0")}-${String(cell.getDate()).padStart(2, "0")}`;
          const dayItems = byDate.get(key) ?? [];
          return <div key={key} className={styles.calendarDay} data-muted={monthKey(cell) !== monthKey(month)}><span className={styles.dayNumber}>{cell.getDate()}</span>{dayItems.slice(0, 3).map((item) => {
            const calendarTitle = item.source === "assignment" ? `${item.title} 마감` : item.title;
            return <span key={item.id} className={styles.calendarEvent} title={`${itemLabel(item)} · ${calendarTitle}`}>{calendarTitle}</span>;
          })}{dayItems.length > 3 && <span className={styles.moreEvents}>+{dayItems.length - 3}</span>}</div>;
        })}</div>
      </section>

      {staff && view.data.series.length > 0 && <section className={styles.scheduleSection}>
        <h2>반복 규칙</h2>
        <p className={styles.helper}>`계속` 일정은 규칙을 저장하고 앞으로 약 6개월 구간을 자동 생성합니다. 일정을 열 때 다음 구간이 계속 채워집니다.</p>
        <div className={styles.scheduleList}>{view.data.series.map((series) => <article key={series.id}>
          <div><span className={styles.scheduleCategory}>{series.kind === "project" ? "프로젝트 제출" : categoryLabels[series.event_category ?? "other"]}</span><strong>{series.title}</strong><p>{recurrenceSummary(series)}</p></div>
          <button className={styles.smallButton} onClick={() => openEditSeries(series)}>규칙 수정</button>
        </article>)}</div>
      </section>}

      <section className={styles.scheduleSection}>
        <div className={styles.headingRow}>
          <div><h2>전체 일정</h2>{bulkMode && <p className={styles.helper}>체크한 일정을 표에서 직접 수정하고 한 번에 저장합니다. 반복 일정에서 생성된 한 회차를 수정해도 반복 규칙 자체는 바뀌지 않습니다.</p>}</div>
          {staff && items.length > 0 && <button className={styles.smallButton} onClick={bulkMode ? closeBulkEdit : openBulkEdit}>{bulkMode ? "일괄 수정 닫기" : "일괄 수정"}</button>}
        </div>

        {bulkMode ? <>
          <div className={styles.bulkScheduleToolbar}>
            <button className={styles.smallButton} type="button" onClick={toggleAllBulkItems}>{bulkSelected.length === items.length ? "전체 선택 해제" : "전체 선택"}</button>
            <span>{bulkSelected.length}개 선택</span>
            <label>선택 일정 날짜 이동
              <input type="number" value={bulkShiftDays} onChange={(event) => setBulkShiftDays(Number(event.target.value))} />
              <span>일</span>
            </label>
            <button className={styles.smallButton} type="button" disabled={bulkSelected.length === 0 || bulkShiftDays === 0} onClick={shiftSelectedBulkRows}>이동 적용</button>
            <button className={styles.button} type="button" disabled={busy || bulkSelected.length === 0} onClick={() => void saveBulkRows()}>{busy ? "저장 중…" : "선택 일정 저장"}</button>
            <button className={styles.dangerButton} type="button" disabled={busy || bulkSelected.length === 0} onClick={() => void deleteBulkRows(false)}>선택 삭제</button>
            <button className={styles.dangerButton} type="button" disabled={busy || items.length === 0 && view.data.series.length === 0} onClick={() => void deleteBulkRows(true)}>전체 삭제</button>
          </div>
          <div className={styles.bulkScheduleWrap}><table className={styles.bulkScheduleTable}>
            <thead><tr><th>선택</th><th>종류</th><th>제목</th><th>시작</th><th>종료 / 마감</th><th>비고</th></tr></thead>
            <tbody>{items.map((item) => {
              const row = bulkRows[item.id];
              const selected = bulkSelected.includes(item.id);
              return <tr key={item.id} data-selected={selected}>
                <td><input type="checkbox" aria-label={`${item.title} 선택`} checked={selected} onChange={() => toggleBulkItem(item.id)} /></td>
                <td><span className={styles.scheduleCategory}>{itemLabel(item)}</span></td>
                <td><input className={styles.bulkScheduleInput} disabled={!selected} value={row?.title ?? item.title} onChange={(event) => updateBulkRow(item.id, "title", event.target.value)} /></td>
                <td><input className={styles.bulkScheduleInput} type="datetime-local" disabled={!selected} value={row?.start ?? localInput(item.start_at)} onChange={(event) => updateBulkRow(item.id, "start", event.target.value)} /></td>
                <td><input className={styles.bulkScheduleInput} type="datetime-local" disabled={!selected} value={row?.end ?? localInput(item.end_at)} onChange={(event) => updateBulkRow(item.id, "end", event.target.value)} /></td>
                <td>{item.schedule_series_id ? <span className={styles.secondary}>반복 생성 회차</span> : <span className={styles.secondary}>개별 일정</span>}</td>
              </tr>;
            })}</tbody>
          </table></div>
        </> : <div className={styles.scheduleList}>{items.map((item) => <article key={item.id}>
          <div><span className={styles.scheduleCategory}>{itemLabel(item)}</span><strong>{item.title}</strong><p>{displayDate(item.start_at)}{item.end_at ? ` → ${displayDate(item.end_at)}` : ""}</p>{item.description && <p>{item.description}</p>}</div>
          <div className={styles.actions}>{item.link_url && <a className={styles.textLink} href={item.link_url} target="_blank" rel="noopener noreferrer">링크 ↗</a>}{staff && <button className={styles.smallButton} onClick={() => editItem(item)}>{item.schedule_series_id ? "반복 규칙 수정" : "수정"}</button>}</div>
        </article>)}</div>}
        {items.length === 0 && <p className={styles.notice}>등록된 일정이 없습니다.</p>}
      </section>
    </>}

    {staff && showForm && <div className={styles.modalBackdrop} role="presentation"><section className={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby="schedule-form-title">
      <div className={styles.headingRow}><div><h2 id="schedule-form-title">{editing ? "일정 수정" : "일정 추가"}</h2><p className={styles.helper}>일반 일정은 캘린더에만 표시되고, 프로젝트 제출은 각 발생 회차마다 실제 제출창을 만듭니다.</p></div><button className={styles.smallButton} onClick={() => setShowForm(false)}>닫기</button></div>

      {!editing && <label className={styles.field}>일정 종류<select value={mode} onChange={(event) => setMode(event.target.value as EditorMode)}><option value="event">일반 일정</option><option value="project">프로젝트 제출</option></select></label>}

      <div className={styles.formGrid}>
        <label className={styles.field}>제목<input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} placeholder={mode === "project" ? "예: ASC 프로젝트" : "예: 정기 세미나"} /></label>
        {mode === "event" ? <label className={styles.field}>분류<select value={category} onChange={(event) => setCategory(event.target.value as Exclude<EventCategory, "project">)}>{generalCategories.map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}</select></label> : <label className={styles.field}>제출 방식<select value={projectPattern} onChange={(event) => setProjectPattern(event.target.value as ScheduleProjectPattern)}><option value="individual">개인 프로젝트</option><option value="team">팀 프로젝트</option><option value="alternating">개인 ↔ 팀 교대</option></select></label>}
        <label className={styles.field}>{mode === "project" ? "첫 제출 시작" : "첫 시작"}<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label className={styles.field}>{mode === "project" ? "첫 마감" : "첫 종료"}<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
        {mode === "event" && <label className={styles.field}>링크 <span className={styles.secondary}>선택</span><input value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://" /></label>}
      </div>

      {editing?.kind !== "event" && editing?.kind !== "assignment" && <section className={styles.recurrenceBox}>
        <h3>반복 설정</h3>
        <div className={styles.formGrid}>
          <label className={styles.field}>반복<select value={frequency} onChange={(event) => setRecurrenceFrequency(event.target.value as ScheduleRecurrenceFrequency)}>{(Object.entries(recurrenceLabels) as Array<[ScheduleRecurrenceFrequency, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {frequency !== "none" && <label className={styles.field}>반복 간격<input type="number" min={1} max={31} value={recurrenceInterval} onChange={(event) => setRecurrenceInterval(Number(event.target.value))} /><span className={styles.secondary}>예: 매 2주라면 반복=매주, 간격=2</span></label>}
        </div>

        {frequency === "weekly" && <div className={styles.weekdayPicker} aria-label="반복 요일">{weekdayLabels.map((label, day) => <button key={label} type="button" data-active={weekdays.includes(day)} onClick={() => toggleWeekday(day)}>{label}</button>)}</div>}

        {frequency !== "none" && <div className={styles.formGrid}>
          <label className={styles.field}>반복 종료<select value={endMode} onChange={(event) => setEndMode(event.target.value as ScheduleRecurrenceEndMode)}><option value="count">횟수 지정</option><option value="until">날짜까지</option><option value="never">계속</option></select></label>
          {endMode === "count" && <label className={styles.field}>총 횟수<input type="number" min={1} max={500} value={occurrenceCount} onChange={(event) => setOccurrenceCount(Number(event.target.value))} /></label>}
          {endMode === "until" && <label className={styles.field}>종료 날짜/시간<input type="datetime-local" value={until} onChange={(event) => setUntil(event.target.value)} /></label>}
        </div>}
        {endMode === "never" && frequency !== "none" && <p className={styles.helper}>계속 반복은 규칙만 영구 저장합니다. 시스템이 앞으로 약 6개월의 일정을 자동 생성하고, 이후 접속할 때 다음 구간을 계속 채웁니다.</p>}
      </section>}

      <label className={styles.field}>설명<textarea rows={4} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>

      {editing?.kind !== "event" && editing?.kind !== "assignment" && seriesPreview.length > 0 && <div className={styles.teamBox}><h2>반복 미리보기</h2><div className={styles.scheduleList}>{seriesPreview.slice(0, 8).map((occurrence) => {
        const projectType = projectPattern === "alternating" ? (occurrence.index % 2 === 0 ? "개인" : "팀") : projectPattern === "team" ? "팀" : "개인";
        return <article key={occurrence.index}><div>{mode === "project" && <span className={styles.scheduleCategory}>{projectType}</span>}<strong>{frequency === "none" ? title : `${title} ${occurrence.index + 1}회차`}</strong><p>{displayDate(occurrence.start_at)} → {displayDate(occurrence.end_at)}</p></div></article>;
      })}</div>{seriesPreview.length >= 8 && <p className={styles.helper}>앞 8개 일정만 미리 보여줍니다.</p>}</div>}

      {message && <p className={styles.notice} role="status">{message}</p>}
      <div className={styles.actions}><button className={styles.button} disabled={busy} onClick={() => void persist()}>{busy ? "저장 중…" : editing ? "변경 저장" : "일정 저장"}</button>{editing && <button className={styles.dangerButton} disabled={busy} onClick={() => void remove()}>삭제</button>}</div>
    </section></div>}
  </main>;
}

export default function SchedulePage() {
  const { state } = useMemberSession();
  return <MemberGate>{state.status === "ready" && <ScheduleView profile={state.profile} />}</MemberGate>;
}
