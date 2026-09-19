import { corsHeaders, currentSemester, errorResponse, HttpError, json, requireStaff } from "../_shared/security.ts";

type ResourceService = "notion" | "google_drive" | "google_docs" | "google_sheets" | "google_forms" | "github" | "discord" | "other";
type ResourceCategory = "study" | "project" | "ctf" | "recruitment" | "operations" | "other";
type ResourceAudience = "member" | "staff";
type Action = "save_staff_memo" | "save_recruitment_settings" | "create_link" | "update_link" | "deactivate_link" | "reorder_links";

type Body = {
  action?: Action;
  expected_version?: number;
  staff_memo?: string;
  resource_id?: string;
  resource_ids?: string[];
  title?: string;
  description?: string;
  url?: string;
  service?: ResourceService;
  category?: ResourceCategory;
  audience?: ResourceAudience;
  enabled?: boolean;
  button_label?: string;
  button_href?: string;
  starts_at?: string | null;
  ends_at?: string | null;
};

type ResourceRow = {
  id: string;
  semester: string;
  title: string;
  description: string;
  url: string;
  service: ResourceService;
  category: ResourceCategory;
  audience: ResourceAudience;
  sort_order: number;
  active: boolean;
  version: number;
  updated_at: string;
};

const RESOURCE_FIELDS = "id,semester,title,description,url,service,category,audience,sort_order,active,version,updated_at";
const SERVICES = new Set<ResourceService>(["notion", "google_drive", "google_docs", "google_sheets", "google_forms", "github", "discord", "other"]);
const CATEGORIES = new Set<ResourceCategory>(["study", "project", "ctf", "recruitment", "operations", "other"]);
const AUDIENCES = new Set<ResourceAudience>(["member", "staff"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanExpectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new HttpError(400, "버전 정보를 확인해 주세요.");
  return Number(value);
}

function cleanStaffMemo(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "운영진 메모를 확인해 주세요.");
  if (value.length > 20000) throw new HttpError(400, "운영진 메모는 20000자 이하로 입력해 주세요.");
  return value;
}

function cleanHttpsUrl(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "자료 링크를 입력해 주세요.");
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 2048) throw new HttpError(400, "자료 링크 길이를 확인해 주세요.");
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new HttpError(400, "자료 링크 형식을 확인해 주세요."); }
  if (url.protocol !== "https:") throw new HttpError(400, "자료 링크는 https 주소만 사용할 수 있습니다.");
  return url.toString();
}

function cleanTitle(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (title.length < 1 || title.length > 120) throw new HttpError(400, "자료 제목은 1~120자로 입력해 주세요.");
  return title;
}

function cleanDescription(value: unknown): string {
  const description = typeof value === "string" ? value.trim() : "";
  if (description.length > 1000) throw new HttpError(400, "자료 설명은 1000자 이하로 입력해 주세요.");
  return description;
}

function cleanService(value: unknown): ResourceService {
  if (typeof value !== "string" || !SERVICES.has(value as ResourceService)) throw new HttpError(400, "자료 서비스를 확인해 주세요.");
  return value as ResourceService;
}

function cleanCategory(value: unknown): ResourceCategory {
  if (typeof value !== "string" || !CATEGORIES.has(value as ResourceCategory)) throw new HttpError(400, "자료 분류를 확인해 주세요.");
  return value as ResourceCategory;
}

function cleanAudience(value: unknown): ResourceAudience {
  if (typeof value !== "string" || !AUDIENCES.has(value as ResourceAudience)) throw new HttpError(400, "자료 공개 범위를 확인해 주세요.");
  return value as ResourceAudience;
}

function cleanResourceId(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new HttpError(400, "자료 식별자를 확인해 주세요.");
  return value;
}

function cleanLinkValues(body: Body) {
  return {
    title: cleanTitle(body.title),
    description: cleanDescription(body.description),
    url: cleanHttpsUrl(body.url),
    service: cleanService(body.service),
    category: cleanCategory(body.category),
    audience: cleanAudience(body.audience),
  };
}

function cleanOptionalDate(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, `${label}을 확인해 주세요.`);
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new HttpError(400, `${label}을 확인해 주세요.`);
  return date.toISOString();
}

function cleanRecruitmentValues(body: Body) {
  if (typeof body.enabled !== "boolean") throw new HttpError(400, "리크루팅 팝업 사용 여부를 확인해 주세요.");
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const buttonLabel = typeof body.button_label === "string" ? body.button_label.trim() : "";
  const buttonHref = typeof body.button_href === "string" ? body.button_href.trim() : "";
  if (!title || title.length > 100) throw new HttpError(400, "리크루팅 제목은 1~100자로 입력해 주세요.");
  if (description.length > 500) throw new HttpError(400, "리크루팅 설명은 500자 이하로 입력해 주세요.");
  if (!buttonLabel || buttonLabel.length > 80) throw new HttpError(400, "버튼 문구는 1~80자로 입력해 주세요.");
  if (!(buttonHref.startsWith("/") || buttonHref.startsWith("https://"))) throw new HttpError(400, "버튼 이동 주소는 사이트 경로(/...) 또는 https 주소만 사용할 수 있습니다.");
  const startsAt = cleanOptionalDate(body.starts_at, "노출 시작 시간");
  const endsAt = cleanOptionalDate(body.ends_at, "노출 종료 시간");
  if (startsAt && endsAt && new Date(endsAt).valueOf() <= new Date(startsAt).valueOf()) throw new HttpError(400, "노출 종료 시간은 시작 시간 이후여야 합니다.");
  return { enabled: body.enabled, title, description, button_label: buttonLabel, button_href: buttonHref, starts_at: startsAt, ends_at: endsAt };
}

async function readResource(client: Awaited<ReturnType<typeof requireStaff>>["client"], semester: string, id: string) {
  const { data, error } = await client.from("resource_links")
    .select(RESOURCE_FIELDS).eq("semester", semester).eq("id", id).maybeSingle<ResourceRow>();
  if (error) throw error;
  if (!data) throw new HttpError(404, "자료 링크를 찾을 수 없습니다.");
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "POST 요청만 허용됩니다." });

  try {
    const { client, profile } = await requireStaff(req);
    const body = await req.json() as Body;
    const action = body.action;
    if (!action) throw new HttpError(400, "작업을 선택해 주세요.");

    if (action === "save_staff_memo") {
      const expectedVersion = cleanExpectedVersion(body.expected_version);
      if (expectedVersion < 1) throw new HttpError(400, "운영진 메모 버전을 확인해 주세요.");
      const { data, error } = await client.rpc("update_staff_private_settings_atomic", {
        p_expected_version: expectedVersion,
        p_staff_memo: cleanStaffMemo(body.staff_memo),
        p_actor: profile.id,
      });
      if (error?.code === "P0001") throw new HttpError(409, "운영진 메모가 변경되었습니다. 새로고침 후 다시 저장해 주세요.");
      if (error?.code === "22023") throw new HttpError(400, error.message ?? "운영진 메모를 확인해 주세요.");
      if (error) throw error;
      return json(req, 200, { ok: true, settings: Array.isArray(data) ? data[0] : data });
    }

    if (action === "save_recruitment_settings") {
      const expectedVersion = cleanExpectedVersion(body.expected_version);
      if (expectedVersion < 1) throw new HttpError(400, "리크루팅 설정 버전을 확인해 주세요.");
      const values = cleanRecruitmentValues(body);
      const { data, error } = await client.from("public_recruitment_settings")
        .update({ ...values, version: expectedVersion + 1, updated_by: profile.id, updated_at: new Date().toISOString() })
        .eq("id", true).eq("version", expectedVersion)
        .select("id,enabled,title,description,button_label,button_href,starts_at,ends_at,version,updated_at")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(409, "리크루팅 설정이 변경되었습니다. 새로고침 후 다시 저장해 주세요.");
      return json(req, 200, { ok: true, recruitment: data });
    }

    const semester = await currentSemester(client);
    const now = new Date().toISOString();

    if (action === "create_link") {
      const values = cleanLinkValues(body);
      const { data: last, error: lastError } = await client.from("resource_links")
        .select("sort_order").eq("semester", semester).eq("active", true)
        .order("sort_order", { ascending: false }).limit(1).maybeSingle<{ sort_order: number }>();
      if (lastError) throw lastError;
      const sortOrder = (last?.sort_order ?? 0) + 10;
      if (sortOrder > 1000000) throw new HttpError(409, "자료 순서 값이 가득 찼습니다. 순서를 다시 정리해 주세요.");
      const { data, error } = await client.from("resource_links")
        .insert({ semester, ...values, sort_order: sortOrder, active: true, version: 1, created_by: profile.id, updated_by: profile.id, created_at: now, updated_at: now })
        .select(RESOURCE_FIELDS).single<ResourceRow>();
      if (error) throw error;
      return json(req, 200, { ok: true, link: data });
    }

    if (action === "update_link") {
      const resourceId = cleanResourceId(body.resource_id);
      const expectedVersion = cleanExpectedVersion(body.expected_version);
      const existing = await readResource(client, semester, resourceId);
      if (existing.version !== expectedVersion) throw new HttpError(409, "자료 링크가 변경되었습니다. 새로고침 후 다시 수정해 주세요.");
      const values = cleanLinkValues(body);
      const { data, error } = await client.from("resource_links")
        .update({ ...values, version: existing.version + 1, updated_by: profile.id, updated_at: now })
        .eq("semester", semester).eq("id", resourceId).eq("version", existing.version)
        .select(RESOURCE_FIELDS).maybeSingle<ResourceRow>();
      if (error) throw error;
      if (!data) throw new HttpError(409, "자료 링크가 변경되었습니다. 새로고침 후 다시 수정해 주세요.");
      return json(req, 200, { ok: true, link: data });
    }

    if (action === "deactivate_link") {
      const resourceId = cleanResourceId(body.resource_id);
      const expectedVersion = cleanExpectedVersion(body.expected_version);
      const existing = await readResource(client, semester, resourceId);
      if (existing.version !== expectedVersion) throw new HttpError(409, "자료 링크가 변경되었습니다. 새로고침 후 다시 삭제해 주세요.");
      const { data, error } = await client.from("resource_links")
        .update({ active: false, version: existing.version + 1, updated_by: profile.id, updated_at: now })
        .eq("semester", semester).eq("id", resourceId).eq("version", existing.version)
        .select(RESOURCE_FIELDS).maybeSingle<ResourceRow>();
      if (error) throw error;
      if (!data) throw new HttpError(409, "자료 링크가 변경되었습니다. 새로고침 후 다시 삭제해 주세요.");
      return json(req, 200, { ok: true, link: data });
    }

    if (action === "reorder_links") {
      if (!Array.isArray(body.resource_ids) || body.resource_ids.length > 200) throw new HttpError(400, "자료 순서 목록을 확인해 주세요.");
      const resourceIds = body.resource_ids.map(cleanResourceId);
      if (new Set(resourceIds).size !== resourceIds.length) throw new HttpError(400, "자료 순서에 중복된 항목이 있습니다.");
      if (resourceIds.length === 0) return json(req, 200, { ok: true, links: [] });

      const { data: rows, error: rowsError } = await client.from("resource_links")
        .select("id,version").eq("semester", semester).eq("active", true).in("id", resourceIds)
        .returns<Array<{ id: string; version: number }>>();
      if (rowsError) throw rowsError;
      if (rows.length !== resourceIds.length) throw new HttpError(409, "자료 목록이 변경되었습니다. 새로고침 후 다시 정렬해 주세요.");
      const rowMap = new Map(rows.map((row) => [row.id, row]));
      const updated: ResourceRow[] = [];
      for (let index = 0; index < resourceIds.length; index += 1) {
        const id = resourceIds[index];
        const row = rowMap.get(id)!;
        const { data, error } = await client.from("resource_links")
          .update({ sort_order: (index + 1) * 10, version: row.version + 1, updated_by: profile.id, updated_at: now })
          .eq("semester", semester).eq("id", id).eq("version", row.version)
          .select(RESOURCE_FIELDS).maybeSingle<ResourceRow>();
        if (error) throw error;
        if (!data) throw new HttpError(409, "자료 목록이 변경되었습니다. 새로고침 후 다시 정렬해 주세요.");
        updated.push(data);
      }
      return json(req, 200, { ok: true, links: updated });
    }

    throw new HttpError(400, "지원하지 않는 작업입니다.");
  } catch (error) {
    return errorResponse(req, error);
  }
});
