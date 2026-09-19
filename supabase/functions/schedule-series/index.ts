import { corsHeaders, currentSemester, errorResponse, HttpError, json, requireStaff, requireUser } from "../_shared/security.ts";
import { generateScheduleOccurrences, type RecurrenceEndMode, type RecurrenceFrequency } from "../../../shared/schedule-recurrence.ts";

type ScheduleKind = "event" | "project";
type EventCategory = "seminar" | "ctf" | "meeting" | "presentation" | "other";
type ProjectPattern = "individual" | "team" | "alternating";
type Action = "materialize" | "create" | "update" | "deactivate";

type Body = {
  action?: Action;
  series_id?: string;
  expected_version?: number;
  kind?: ScheduleKind;
  title?: string;
  description?: string;
  event_category?: EventCategory | null;
  project_pattern?: ProjectPattern | null;
  link_url?: string | null;
  all_day?: boolean;
  first_start_at?: string;
  first_end_at?: string;
  recurrence_frequency?: RecurrenceFrequency;
  recurrence_interval?: number;
  weekdays?: number[];
  end_mode?: RecurrenceEndMode;
  occurrence_count?: number | null;
  until_at?: string | null;
};

type SeriesRow = {
  id: string;
  semester: string;
  kind: ScheduleKind;
  title: string;
  description: string;
  event_category: EventCategory | null;
  project_pattern: ProjectPattern | null;
  link_url: string | null;
  all_day: boolean;
  first_start_at: string;
  first_end_at: string;
  recurrence_frequency: RecurrenceFrequency;
  recurrence_interval: number;
  weekdays: number[];
  end_mode: RecurrenceEndMode;
  occurrence_count: number | null;
  until_at: string | null;
  active: boolean;
  version: number;
};

const SERIES_FIELDS = "id,semester,kind,title,description,event_category,project_pattern,link_url,all_day,first_start_at,first_end_at,recurrence_frequency,recurrence_interval,weekdays,end_mode,occurrence_count,until_at,active,version";
const EVENT_CATEGORIES = new Set<EventCategory>(["seminar", "ctf", "meeting", "presentation", "other"]);
const PROJECT_PATTERNS = new Set<ProjectPattern>(["individual", "team", "alternating"]);
const FREQUENCIES = new Set<RecurrenceFrequency>(["none", "daily", "weekly", "monthly"]);
const END_MODES = new Set<RecurrenceEndMode>(["count", "until", "never"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanId(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new HttpError(400, "반복 일정을 확인해 주세요.");
  return value;
}

function cleanVersion(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new HttpError(400, "반복 일정 버전을 확인해 주세요.");
  return Number(value);
}

function cleanDate(value: unknown, label: string): string {
  if (typeof value !== "string") throw new HttpError(400, `${label}을 확인해 주세요.`);
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new HttpError(400, `${label}을 확인해 주세요.`);
  return date.toISOString();
}

function kstDate(value: string): string {
  return new Date(new Date(value).valueOf() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function allDayStart(value: string): string {
  return new Date(`${kstDate(value)}T00:00:00+09:00`).toISOString();
}

function allDayEnd(value: string): string {
  return new Date(`${kstDate(value)}T23:59:59.999+09:00`).toISOString();
}

function cleanUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "일정 링크를 확인해 주세요.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new HttpError(400, "일정 링크 형식을 확인해 주세요."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new HttpError(400, "일정 링크는 http/https 주소만 사용할 수 있습니다.");
  return url.toString();
}

function cleanSeries(body: Body) {
  const kind = body.kind;
  if (kind !== "event" && kind !== "project") throw new HttpError(400, "일정 종류를 확인해 주세요.");
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 160) throw new HttpError(400, "일정 제목은 1~160자로 입력해 주세요.");
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length > 4000) throw new HttpError(400, "일정 설명은 4000자 이하로 입력해 주세요.");

  const allDay = body.all_day === true;
  const rawFirstStart = cleanDate(body.first_start_at, kind === "project" ? "첫 제출 시작 시간" : "첫 시작 시간");
  const rawFirstEnd = cleanDate(body.first_end_at, kind === "project" ? "첫 마감 시간" : "첫 종료 시간");
  const firstStart = allDay ? allDayStart(rawFirstStart) : rawFirstStart;
  const firstEnd = allDay ? allDayEnd(rawFirstEnd) : rawFirstEnd;
  if (new Date(firstEnd).valueOf() <= new Date(firstStart).valueOf()) throw new HttpError(400, "종료 시간은 시작 시간 이후여야 합니다.");

  const frequency = body.recurrence_frequency;
  if (typeof frequency !== "string" || !FREQUENCIES.has(frequency as RecurrenceFrequency)) throw new HttpError(400, "반복 주기를 확인해 주세요.");
  const recurrenceFrequency = frequency as RecurrenceFrequency;
  const recurrenceInterval = Number(body.recurrence_interval ?? 1);
  if (!Number.isInteger(recurrenceInterval) || recurrenceInterval < 1 || recurrenceInterval > 31) throw new HttpError(400, "반복 간격은 1~31로 입력해 주세요.");

  const weekdays = recurrenceFrequency === "weekly"
    ? [...new Set((Array.isArray(body.weekdays) ? body.weekdays : []).map(Number))].sort((a, b) => a - b)
    : [];
  if (recurrenceFrequency === "weekly" && (weekdays.length < 1 || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) {
    throw new HttpError(400, "매주 반복할 요일을 하나 이상 선택해 주세요.");
  }

  let endMode: RecurrenceEndMode;
  let occurrenceCount: number | null = null;
  let untilAt: string | null = null;
  if (recurrenceFrequency === "none") {
    endMode = "count";
    occurrenceCount = 1;
  } else {
    const requestedEndMode = body.end_mode;
    if (typeof requestedEndMode !== "string" || !END_MODES.has(requestedEndMode as RecurrenceEndMode)) throw new HttpError(400, "반복 종료 방식을 확인해 주세요.");
    endMode = requestedEndMode as RecurrenceEndMode;
    if (endMode === "count") {
      occurrenceCount = Number(body.occurrence_count);
      if (!Number.isInteger(occurrenceCount) || occurrenceCount < 1 || occurrenceCount > 500) throw new HttpError(400, "반복 횟수는 1~500회로 입력해 주세요.");
    } else if (endMode === "until") {
      const rawUntil = cleanDate(body.until_at, "반복 종료일");
      untilAt = allDay ? allDayEnd(rawUntil) : rawUntil;
      if (new Date(untilAt).valueOf() < new Date(firstStart).valueOf()) throw new HttpError(400, "반복 종료일은 첫 일정 이후여야 합니다.");
    }
  }

  let eventCategory: EventCategory | null = null;
  let projectPattern: ProjectPattern | null = null;
  if (kind === "event") {
    if (typeof body.event_category !== "string" || !EVENT_CATEGORIES.has(body.event_category as EventCategory)) throw new HttpError(400, "일정 분류를 확인해 주세요.");
    eventCategory = body.event_category as EventCategory;
  } else {
    if (typeof body.project_pattern !== "string" || !PROJECT_PATTERNS.has(body.project_pattern as ProjectPattern)) throw new HttpError(400, "프로젝트 제출 종류를 확인해 주세요.");
    projectPattern = body.project_pattern as ProjectPattern;
  }

  const normalized = {
    kind,
    title,
    description,
    event_category: eventCategory,
    project_pattern: projectPattern,
    link_url: kind === "event" ? cleanUrl(body.link_url) : null,
    all_day: allDay,
    first_start_at: firstStart,
    first_end_at: firstEnd,
    recurrence_frequency: recurrenceFrequency,
    recurrence_interval: recurrenceInterval,
    weekdays,
    end_mode: endMode,
    occurrence_count: occurrenceCount,
    until_at: untilAt,
  };

  try {
    generateScheduleOccurrences(normalized, { horizon_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString() });
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "반복 설정을 확인해 주세요.");
  }
  return normalized;
}

function projectTypeFor(series: SeriesRow, index: number): "individual" | "team" {
  if (series.project_pattern === "team") return "team";
  if (series.project_pattern === "alternating") return index % 2 === 0 ? "individual" : "team";
  return "individual";
}

function projectTitleFor(series: SeriesRow, index: number): string {
  return series.recurrence_frequency === "none" ? series.title : `${series.title} ${index + 1}회차`;
}

async function materializeSeries(client: Awaited<ReturnType<typeof requireUser>>["client"], series: SeriesRow) {
  const horizonAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
  const occurrences = generateScheduleOccurrences(series, { horizon_at: horizonAt, max_occurrences: 500 });
  for (const occurrence of occurrences) {
    if (series.kind === "event") {
      const { error } = await client.from("events").upsert({
        semester: series.semester,
        title: series.title,
        category: series.event_category,
        description: series.description,
        start_at: occurrence.start_at,
        end_at: occurrence.end_at,
        link_url: series.link_url,
        all_day: series.all_day,
        schedule_series_id: series.id,
        occurrence_index: occurrence.index,
        updated_at: new Date().toISOString(),
      }, { onConflict: "schedule_series_id,occurrence_index", ignoreDuplicates: true });
      if (error) throw error;
      continue;
    }
    const { error } = await client.rpc("materialize_schedule_assignment", {
      p_series_id: series.id,
      p_occurrence_index: occurrence.index,
      p_project_type: projectTypeFor(series, occurrence.index),
      p_title: projectTitleFor(series, occurrence.index),
      p_description: series.description,
      p_opens_at: occurrence.start_at,
      p_due_at: occurrence.end_at,
      p_all_day: series.all_day,
    });
    if (error) throw error;
  }
  return occurrences.length;
}

async function cleanupFutureOccurrences(client: Awaited<ReturnType<typeof requireStaff>>["client"], seriesId: string) {
  const now = new Date().toISOString();
  const eventDelete = await client.from("events").delete().eq("schedule_series_id", seriesId).gte("start_at", now);
  if (eventDelete.error) throw eventDelete.error;

  const assignments = await client.from("assignments").select("id").eq("schedule_series_id", seriesId).gte("opens_at", now);
  if (assignments.error) throw assignments.error;
  const ids = (assignments.data ?? []).map((row: { id: string }) => row.id);
  if (ids.length === 0) return;
  const submissionRows = await client.from("submissions").select("assignment_id").in("assignment_id", ids);
  if (submissionRows.error) throw submissionRows.error;
  const protectedIds = new Set((submissionRows.data ?? []).map((row: { assignment_id: string }) => row.assignment_id));
  const removable = ids.filter((id: string) => !protectedIds.has(id));
  if (removable.length > 0) {
    const deletion = await client.from("assignments").delete().in("id", removable);
    if (deletion.error) throw deletion.error;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "POST 요청만 허용됩니다." });

  try {
    const body = await req.json() as Body;
    if (body.action === "materialize") {
      const { client } = await requireUser(req);
      const semester = await currentSemester(client);
      const { data, error } = await client.from("schedule_series").select(SERIES_FIELDS).eq("semester", semester).eq("active", true).returns<SeriesRow[]>();
      if (error) throw error;
      let count = 0;
      for (const series of data ?? []) count += await materializeSeries(client, series);
      return json(req, 200, { ok: true, materialized: count });
    }

    const { client, profile } = await requireStaff(req);
    const semester = await currentSemester(client);
    if (body.action === "create") {
      const values = cleanSeries(body);
      const { data, error } = await client.from("schedule_series")
        .insert({ semester, ...values, active: true, version: 1, created_by: profile.id, updated_by: profile.id })
        .select(SERIES_FIELDS).single<SeriesRow>();
      if (error) throw error;
      await materializeSeries(client, data);
      return json(req, 200, { ok: true, series: data });
    }

    if (body.action === "update") {
      const seriesId = cleanId(body.series_id);
      const expectedVersion = cleanVersion(body.expected_version);
      const values = cleanSeries(body);
      const { data: current, error: currentError } = await client.from("schedule_series")
        .select(SERIES_FIELDS).eq("id", seriesId).eq("semester", semester).maybeSingle<SeriesRow>();
      if (currentError) throw currentError;
      if (!current || current.version !== expectedVersion) throw new HttpError(409, "반복 일정이 변경되었습니다. 새로고침 후 다시 수정해 주세요.");
      await cleanupFutureOccurrences(client, seriesId);
      const { data, error } = await client.from("schedule_series")
        .update({ ...values, version: expectedVersion + 1, updated_by: profile.id, updated_at: new Date().toISOString() })
        .eq("id", seriesId).eq("version", expectedVersion).select(SERIES_FIELDS).maybeSingle<SeriesRow>();
      if (error) throw error;
      if (!data) throw new HttpError(409, "반복 일정이 변경되었습니다. 새로고침 후 다시 수정해 주세요.");
      await materializeSeries(client, data);
      return json(req, 200, { ok: true, series: data });
    }

    if (body.action === "deactivate") {
      const seriesId = cleanId(body.series_id);
      const expectedVersion = cleanVersion(body.expected_version);
      await cleanupFutureOccurrences(client, seriesId);
      const { data, error } = await client.from("schedule_series")
        .update({ active: false, version: expectedVersion + 1, updated_by: profile.id, updated_at: new Date().toISOString() })
        .eq("id", seriesId).eq("semester", semester).eq("version", expectedVersion).eq("active", true)
        .select("id,version").maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(409, "반복 일정이 변경되었습니다. 새로고침 후 다시 삭제해 주세요.");
      return json(req, 200, { ok: true, series: data });
    }

    throw new HttpError(400, "지원하지 않는 반복 일정 작업입니다.");
  } catch (error) {
    return errorResponse(req, error);
  }
});
