"use client";

import { useState, type FormEvent } from "react";
import { MemberGate, useMemberSession } from "@/component/member/MemberSession";
import { MemberToolbar } from "@/component/member/MemberToolbar";
import { validateNewPassword, type Profile } from "@/lib/member-domain";
import styles from "@/styles/member.module.css";

function PasswordForm({ profile }: { profile: Profile }) {
  const { client } = useMemberSession();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || pending) return;
    setSuccess(false);
    const validation = validateNewPassword(password, confirmation);
    setError(validation ?? "");
    if (validation) return;
    setPending(true);
    try {
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword("");
      setConfirmation("");
      setSuccess(true);
    } catch {
      setError("비밀번호를 변경하지 못했습니다. 로그인 상태와 연결을 확인해 주세요.");
    } finally {
      setPending(false);
    }
  }
  return <main className={styles.page}>
    <MemberToolbar profile={profile} />
    <section className={styles.loginPanel} style={{ maxWidth: 500 }}>
      <p className={styles.eyebrow}>ASC MEMBER</p>
      <h1 className={styles.title}>비밀번호 변경</h1>
      <p className={styles.description}>다른 곳에서 사용하지 않는 12자 이상의 비밀번호를 입력해 주세요.</p>
      <form className={styles.form} onSubmit={submit} aria-busy={pending}>
        <label className={styles.field} htmlFor="new-password">새 비밀번호
          <input id="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}
            value={password} onChange={(event) => { setPassword(event.target.value); setSuccess(false); }} disabled={pending} />
        </label>
        <label className={styles.field} htmlFor="confirm-password">새 비밀번호 확인
          <input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}
            value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setSuccess(false); }} disabled={pending} />
        </label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {success && <p role="status" className={styles.notice}>비밀번호가 변경되었습니다.</p>}
        <button className={styles.button} type="submit" disabled={pending}>{pending ? "변경 중…" : "비밀번호 변경"}</button>
      </form>
    </section>
  </main>;
}

export default function MemberPasswordPage() {
  const { state } = useMemberSession();
  return <MemberGate>{state.status === "ready" && <PasswordForm profile={state.profile} />}</MemberGate>;
}
