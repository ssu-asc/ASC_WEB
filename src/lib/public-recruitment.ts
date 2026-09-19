export interface PublicRecruitmentSettings {
  id: boolean;
  enabled: boolean;
  title: string;
  description: string;
  button_label: string;
  button_href: string;
  starts_at: string | null;
  ends_at: string | null;
  version: number;
  updated_at: string;
}

export type PublicRecruitmentSettingsDraft = Pick<PublicRecruitmentSettings,
  "enabled" | "title" | "description" | "button_label" | "button_href" | "starts_at" | "ends_at"
>;

export async function fetchPublicRecruitmentSettings(): Promise<PublicRecruitmentSettings | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!url || !key || typeof window === "undefined") return null;
  const response = await fetch(`${url}/rest/v1/public_recruitment_settings?id=eq.true&select=id,enabled,title,description,button_label,button_href,starts_at,ends_at,version,updated_at`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("리크루팅 설정을 불러오지 못했습니다.");
  const rows = await response.json() as PublicRecruitmentSettings[];
  return rows[0] ?? null;
}
