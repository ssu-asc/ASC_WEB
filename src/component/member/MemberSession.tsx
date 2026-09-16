"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getMemberClient } from "@/lib/supabase";
import { readOwnProfile } from "@/lib/member-api";
import { authEventAction, isActiveStaff, type Profile } from "@/lib/member-domain";
import styles from "@/styles/member.module.css";

type SessionState =
  | { status: "ready"; profile: Profile }
  | { status: "loading" | "signed_out" | "setup" | "blocked" | "error"; message?: string };
interface MemberContext {
  state: SessionState;
  client: SupabaseClient | null;
  reload: () => void;
  signOut: () => Promise<void>;
}
const Context = createContext<MemberContext | null>(null);

export function MemberSessionProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const request = useRef(0);

  const load = useCallback(async (connection: SupabaseClient) => {
    const version = ++request.current;
    setState({ status: "loading" });
    try {
      const { data, error } = await connection.auth.getSession();
      if (request.current !== version) return;
      if (error) throw new Error("로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.");
      if (!data.session) {
        setState({ status: "signed_out" });
        return;
      }
      // Browser state only selects the UI; every data read is still protected by RLS.
      const profile = await readOwnProfile(connection, data.session.user.id);
      if (request.current !== version) return;
      setState(profile.active
        ? { status: "ready", profile }
        : { status: "blocked", message: "비활성화된 계정입니다. 운영진에게 문의해 주세요." });
    } catch (error) {
      if (request.current === version) setState({ status: "error", message: error instanceof Error ? error.message : "회원 정보를 확인하지 못했습니다." });
    }
  }, []);

  useEffect(() => {
    const connection = getMemberClient();
    setClient(connection);
    if (!connection) {
      setState({ status: "setup", message: "Member 연결 설정이 필요합니다. 운영진에게 문의해 주세요." });
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const { data: { subscription } } = connection.auth.onAuthStateChange((event) => {
      const action = authEventAction(event);
      if (action === "ignore") return;
      // Clear private state immediately; never await Supabase calls inside this callback.
      ++request.current;
      clearTimeout(timer);
      if (action === "clear") {
        setState({ status: "signed_out" });
      } else {
        setState({ status: "loading" });
        timer = setTimeout(() => { if (alive) void load(connection); }, 0);
      }
    });
    void load(connection);
    return () => {
      alive = false;
      ++request.current;
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [load]);

  const reload = useCallback(() => { if (client) void load(client); }, [client, load]);
  const signOut = useCallback(async () => {
    if (!client) return;
    ++request.current;
    setState({ status: "loading" });
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
      setState({ status: "signed_out" });
    } catch {
      setState({ status: "error", message: "로그아웃을 완료하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요." });
    }
  }, [client]);

  return <Context.Provider value={{ state, client, reload, signOut }}>{children}</Context.Provider>;
}

export function useMemberSession(): MemberContext {
  const context = useContext(Context);
  if (!context) throw new Error("MemberSessionProvider is required.");
  return context;
}

export function MemberGate({ children, staffOnly = false }: { children: ReactNode; staffOnly?: boolean }) {
  const { state, reload, signOut } = useMemberSession();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "signed_out") router.replace("/member/login");
  }, [state.status, router]);

  if (state.status === "ready") {
    if (staffOnly && !isActiveStaff(state.profile)) {
      return <main className={styles.page}><section className={styles.statePanel}>
        <h1>운영진 전용 페이지입니다.</h1>
        <p>회원 명단은 운영진만 확인할 수 있습니다.</p>
        <Link href="/member" className={styles.textLink}>내 제출 현황으로</Link>
      </section></main>;
    }
    return <>{children}</>;
  }
  const waiting = state.status === "loading" || state.status === "signed_out";
  return <main className={styles.page}><section className={styles.statePanel} aria-busy={waiting}>
    <p className={styles.eyebrow}>ASC MEMBER</p>
    <h1>{waiting ? "회원 정보를 확인하고 있습니다." : state.status === "setup" ? "연결 설정이 필요합니다." : "회원 영역을 열 수 없습니다."}</h1>
    <p role={state.status === "error" ? "alert" : "status"}>{state.message ?? "잠시 후 로그인 상태에 맞는 화면이 표시됩니다."}</p>
    <div className={styles.actions}>
      {state.status === "error" && <button className={styles.button} onClick={reload}>다시 확인</button>}
      {(state.status === "blocked" || state.status === "error") && <button className={styles.button} onClick={() => void signOut()}>로그아웃</button>}
      {!waiting && <Link href="/" className={styles.textLink}>홈으로</Link>}
    </div>
  </section></main>;
}
