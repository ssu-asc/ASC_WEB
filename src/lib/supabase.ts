import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseBrowserConfig } from "./member-domain";

export function getMemberConfiguration() {
  return parseBrowserConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

let browserClient: SupabaseClient | null = null;

/** Never initialize auth while Next is generating the public static export. */
export function getMemberClient(): SupabaseClient | null {
  const config = getMemberConfiguration();
  if (!config.ok || typeof window === "undefined") return null;
  if (!browserClient) {
    browserClient = createClient(config.url, config.key, {
      auth: {
        storageKey: "asc-member-session",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) => fetch(input, {
          ...init,
          signal: init?.signal ?? AbortSignal.timeout(15000),
        }),
      },
    });
  }
  return browserClient;
}
