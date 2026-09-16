import { corsHeaders, errorResponse, HttpError, json, requireStaff } from "../_shared/security.ts";

type Action = "list" | "create" | "update" | "reveal" | "deactivate" | "reactivate" | "list_audit";

type Body = {
  action?: Action;
  secret_id?: string;
  expected_version?: number;
  label?: string;
  account_identifier?: string;
  login_url?: string | null;
  secret?: string | null;
};

type SecretRow = {
  id: string;
  label: string;
  account_identifier: string;
  login_url: string | null;
  active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

type AuditRow = {
  id: number;
  secret_id: string;
  actor_profile_id: string | null;
  action: "created" | "updated" | "revealed" | "deactivated" | "reactivated";
  created_at: string;
};

const SECRET_FIELDS = "id,label,account_identifier,login_url,active,version,created_at,updated_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanId(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new HttpError(400, "공용 계정 식별자를 확인해 주세요.");
  return value;
}

function cleanExpectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new HttpError(400, "공용 계정 버전을 확인해 주세요.");
  return Number(value);
}

function cleanLabel(value: unknown): string {
  const label = typeof value === "string" ? value.trim() : "";
  if (label.length < 1 || label.length > 100) throw new HttpError(400, "공용 계정 이름은 1~100자로 입력해 주세요.");
  return label;
}

function cleanAccountIdentifier(value: unknown): string {
  const account = typeof value === "string" ? value.trim() : "";
  if (account.length > 320) throw new HttpError(400, "계정/아이디는 320자 이하로 입력해 주세요.");
  return account;
}

function cleanLoginUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "로그인 주소를 확인해 주세요.");
  const trimmed = value.trim();
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new HttpError(400, "로그인 주소 형식을 확인해 주세요."); }
  if (url.protocol !== "https:") throw new HttpError(400, "로그인 주소는 https 주소만 사용할 수 있습니다.");
  if (url.toString().length > 2048) throw new HttpError(400, "로그인 주소 길이를 확인해 주세요.");
  return url.toString();
}

function cleanCreateSecret(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048) {
    throw new HttpError(400, "비밀값은 1~2048자로 입력해 주세요.");
  }
  return value;
}

function cleanOptionalSecret(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 2048) throw new HttpError(400, "비밀값은 1~2048자로 입력해 주세요.");
  return value;
}

function normalizeRow(data: unknown): SecretRow {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== "object") throw new Error("staff secret RPC returned no row");
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id),
    label: String(row.label ?? ""),
    account_identifier: String(row.account_identifier ?? ""),
    login_url: typeof row.login_url === "string" ? row.login_url : null,
    active: row.active === true,
    version: Number(row.version),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function handleRpcError(error: { code?: string; message?: string } | null, fallback: string): never | void {
  if (!error) return;
  if (error.code === "P0001") throw new HttpError(409, error.message ?? fallback);
  if (error.code === "P0002") throw new HttpError(404, error.message ?? fallback);
  if (error.code === "22023" || error.code === "23514") throw new HttpError(400, error.message ?? fallback);
  throw error;
}

function noStoreJson(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, private" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "POST 요청만 허용됩니다." });

  try {
    const { client, profile } = await requireStaff(req);
    const body = await req.json() as Body;
    const action = body.action;
    if (!action) throw new HttpError(400, "작업을 선택해 주세요.");

    if (action === "list") {
      const { data, error } = await client.from("staff_shared_secrets")
        .select(SECRET_FIELDS)
        .order("active", { ascending: false })
        .order("label", { ascending: true })
        .returns<SecretRow[]>();
      if (error) throw error;
      return noStoreJson(req, 200, { ok: true, secrets: data ?? [] });
    }

    if (action === "create") {
      const { data, error } = await client.rpc("create_staff_shared_secret_atomic", {
        p_label: cleanLabel(body.label),
        p_account_identifier: cleanAccountIdentifier(body.account_identifier),
        p_login_url: cleanLoginUrl(body.login_url),
        p_secret: cleanCreateSecret(body.secret),
        p_actor: profile.id,
      });
      handleRpcError(error, "공용 계정을 저장하지 못했습니다.");
      return noStoreJson(req, 200, { ok: true, secret: normalizeRow(data) });
    }

    if (action === "update") {
      const { data, error } = await client.rpc("update_staff_shared_secret_atomic", {
        p_secret_id: cleanId(body.secret_id),
        p_expected_version: cleanExpectedVersion(body.expected_version),
        p_label: cleanLabel(body.label),
        p_account_identifier: cleanAccountIdentifier(body.account_identifier),
        p_login_url: cleanLoginUrl(body.login_url),
        p_secret: cleanOptionalSecret(body.secret),
        p_actor: profile.id,
      });
      handleRpcError(error, "공용 계정을 저장하지 못했습니다.");
      return noStoreJson(req, 200, { ok: true, secret: normalizeRow(data) });
    }

    if (action === "reveal") {
      const secretId = cleanId(body.secret_id);
      const { data, error } = await client.rpc("reveal_staff_shared_secret", {
        p_secret_id: secretId,
        p_actor: profile.id,
      });
      if (error?.code === "P0002") throw new HttpError(409, "활성 공용 계정을 확인할 수 없습니다.");
      handleRpcError(error, "비밀정보를 확인하지 못했습니다.");
      if (typeof data !== "string") throw new Error("staff secret reveal returned no plaintext");
      return noStoreJson(req, 200, { ok: true, secret_id: secretId, secret: data });
    }

    if (action === "deactivate" || action === "reactivate") {
      const { data, error } = await client.rpc("set_staff_shared_secret_active", {
        p_secret_id: cleanId(body.secret_id),
        p_expected_version: cleanExpectedVersion(body.expected_version),
        p_active: action === "reactivate",
        p_actor: profile.id,
      });
      handleRpcError(error, "공용 계정 상태를 변경하지 못했습니다.");
      return noStoreJson(req, 200, { ok: true, secret: normalizeRow(data) });
    }

    if (action === "list_audit") {
      const { data: auditRows, error: auditError } = await client.from("staff_shared_secret_audit")
        .select("id,secret_id,actor_profile_id,action,created_at")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(50)
        .returns<AuditRow[]>();
      if (auditError) throw auditError;
      const actorIds = [...new Set((auditRows ?? []).map((row) => row.actor_profile_id).filter((id): id is string => Boolean(id)))];
      const actors = new Map<string, { name: string; member_id: string }>();
      if (actorIds.length > 0) {
        const { data: profiles, error: profileError } = await client.from("profiles")
          .select("id,name,member_id").in("id", actorIds)
          .returns<Array<{ id: string; name: string; member_id: string }>>();
        if (profileError) throw profileError;
        for (const actor of profiles ?? []) actors.set(actor.id, { name: actor.name, member_id: actor.member_id });
      }
      const audits = (auditRows ?? []).map((row) => ({
        id: row.id,
        secret_id: row.secret_id,
        actor_name: row.actor_profile_id ? actors.get(row.actor_profile_id)?.name ?? null : null,
        actor_member_id: row.actor_profile_id ? actors.get(row.actor_profile_id)?.member_id ?? null : null,
        action: row.action,
        created_at: row.created_at,
      }));
      return noStoreJson(req, 200, { ok: true, audits });
    }

    throw new HttpError(400, "지원하지 않는 공용 계정 작업입니다.");
  } catch (error) {
    return errorResponse(req, error);
  }
});
