import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

export type PortalProfile = {
  id: string;
  member_id: string;
  name: string;
  role: "member" | "staff";
  active: boolean;
  github_username: string | null;
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

export function serviceClient(): SupabaseClient {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function configuredOrigins(): Set<string> {
  const configured = Deno.env.get("ASC_WEB_ORIGINS")?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return new Set(configured);
}

function isAllowedOrigin(origin: string): boolean {
  if (configuredOrigins().has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function assertAllowedOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return; // CLI/server-to-server invocation.
  if (!isAllowedOrigin(origin)) throw new HttpError(403, "허용되지 않은 요청 출처입니다.");
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function requireUser(req: Request): Promise<{ client: SupabaseClient; profile: PortalProfile; token: string }> {
  assertAllowedOrigin(req);
  const authorization = req.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, "로그인이 필요합니다.");
  const token = match[1];
  const client = serviceClient();
  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData.user) throw new HttpError(401, "로그인 정보를 확인할 수 없습니다.");
  const { data: profile, error: profileError } = await client.from("profiles")
    .select("id,member_id,name,role,active,github_username").eq("id", authData.user.id).maybeSingle<PortalProfile>();
  if (profileError || !profile) throw new HttpError(403, "ASC 회원 정보를 확인할 수 없습니다.");
  if (!profile.active) throw new HttpError(403, "비활성화된 계정입니다.");
  return { client, profile, token };
}

export async function requireStaff(req: Request): Promise<{ client: SupabaseClient; profile: PortalProfile; token: string }> {
  const result = await requireUser(req);
  if (result.profile.role !== "staff") throw new HttpError(403, "운영진 권한이 필요합니다.");
  return result;
}

export async function currentSemester(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.from("semesters").select("id").eq("active", true).eq("is_current", true).maybeSingle<{ id: string }>();
  if (error || !data) throw new HttpError(409, "현재 학기가 설정되어 있지 않습니다.");
  return data.id;
}

export async function requireSemesterMembership(client: SupabaseClient, profileId: string, semester: string) {
  const { data, error } = await client.from("semester_memberships")
    .select("profile_id,semester,active,individual_required,team_required")
    .eq("profile_id", profileId).eq("semester", semester).maybeSingle();
  if (error || !data || !data.active) throw new HttpError(403, "현재 학기 활동명단에 등록되어 있지 않습니다.");
  return data;
}

export function internalEmail(memberId: string): string {
  const normalized = memberId.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(normalized)) throw new HttpError(400, "아이디 형식을 확인해 주세요.");
  return `${normalized}@members.asc.invalid`;
}

const TEMP_PASSWORD_LOWER = "abcdefghijkmnopqrstuvwxyz";
const TEMP_PASSWORD_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const TEMP_PASSWORD_DIGITS = "23456789";
const TEMP_PASSWORD_SYMBOLS = "!@#$%*-_=+";
const TEMP_PASSWORD_ALPHABET = `${TEMP_PASSWORD_LOWER}${TEMP_PASSWORD_UPPER}${TEMP_PASSWORD_DIGITS}${TEMP_PASSWORD_SYMBOLS}`;

function randomIndex(length: number): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % length;
}

function randomChar(alphabet: string): string {
  return alphabet[randomIndex(alphabet.length)];
}

export function generateTemporaryPassword(): string {
  const chars = [
    randomChar(TEMP_PASSWORD_LOWER),
    randomChar(TEMP_PASSWORD_UPPER),
    randomChar(TEMP_PASSWORD_DIGITS),
    randomChar(TEMP_PASSWORD_SYMBOLS),
  ];
  while (chars.length < 20) chars.push(randomChar(TEMP_PASSWORD_ALPHABET));
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = randomIndex(index + 1);
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }
  return chars.join("");
}

export function validateTemporaryPassword(value: unknown): string {
  const password = typeof value === "string" ? value : "";
  if (password.length < 12 || password.length > 128 || password.trim().length === 0) {
    throw new HttpError(400, "임시 비밀번호는 12~128자로 입력해 주세요.");
  }
  return password;
}

export function errorResponse(req: Request, error: unknown): Response {
  if (error instanceof HttpError) return json(req, error.status, { error: error.message });
  console.error(error);
  return json(req, 500, { error: "서버 작업을 완료하지 못했습니다." });
}
