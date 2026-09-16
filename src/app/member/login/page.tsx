"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemberSession } from "@/component/member/MemberSession";
import { memberIdToEmail } from "@/lib/member-domain";
import styles from "@/styles/member.module.css";

export default function MemberLogin() {
  const { state, client, reload, signOut } = useMemberSession();
  const router = useRouter();
  const [memberId, setMemberId] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (state.status === "ready") router.replace("/member"); }, [state.status, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || pending || state.status === "setup" || state.status === "blocked") return;
    setError("");
    setPending(true);
    try {
      const email = memberIdToEmail(memberId);
      const result = await client.auth.signInWithPassword({ email, password });
      if (result.error) throw new Error("로그인하지 못했습니다. 아이디·비밀번호와 연결 상태를 확인해 주세요.");
      setPassword("");
      reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "로그인하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }
  const unavailable = !client || state.status === "setup" || state.status === "blocked";
  const busy = pending || state.status === "loading" || state.status === "ready";
  return <main className={`${styles.page} ${styles.loginPage}`}>
    <section className={styles.loginPanel} aria-labelledby="member-login-title">
      <p className={styles.eyebrow}>ACADEMIC SECURITY CLUB</p>
      <h1 id="member-login-title" className={styles.title}>ASC Member</h1>
      <p className={styles.description}>ASC에서 발급받은 계정으로 로그인해 주세요.</p>
      {(state.status === "setup" || state.status === "blocked" || state.status === "error") &&
        <p className={styles.notice} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
      <form className={styles.form} onSubmit={submit} aria-busy={busy}>
        <label className={styles.field} htmlFor="member-id">아이디
          <input id="member-id" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
            value={memberId} onChange={(event) => setMemberId(event.target.value)} required minLength={3} maxLength={32} disabled={unavailable || busy} />
        </label>
        <label className={styles.field} htmlFor="member-password">비밀번호
          <input id="member-password" name="password" type="password" autoComplete="current-password"
            value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={128} disabled={unavailable || busy} />
        </label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <button type="submit" className={styles.button} disabled={unavailable || busy}>
          {pending ? "로그인 중…" : state.status === "loading" ? "로그인 상태 확인 중…" : "로그인"}
        </button>
      </form>
      {(state.status === "error" || state.status === "blocked") && <div className={styles.actions}>
        {state.status === "error" && <button className={styles.button} onClick={reload}>다시 확인</button>}
        <button className={styles.button} onClick={() => void signOut()}>로그아웃</button>
      </div>}
      <p className={styles.helper}>계정 발급이나 비밀번호 초기화는 운영진에게 문의해 주세요.</p>
      <Link className={styles.textLink} href="/">ASC 홈으로</Link>
    </section>
  </main>;
}
