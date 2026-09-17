"use client";

import { useEffect, useState } from "react";
import { MemberGate, useMemberSession } from "@/component/member/MemberSession";
import { MemberSpreadsheet } from "@/component/member/MemberSpreadsheet";
import { MemberToolbar } from "@/component/member/MemberToolbar";
import { readSemesterRoster, type SemesterRoster } from "@/lib/member-api";
import { isActiveStaff, type Profile } from "@/lib/member-domain";
import styles from "@/styles/member.module.css";

type View =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: SemesterRoster };

function RosterPage({ profile }: { profile: Profile }) {
  const { client } = useMemberSession();
  const [view, setView] = useState<View>({ status: "loading" });
  const [revision, reload] = useState(0);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    setView({ status: "loading" });
    void readSemesterRoster(client, profile)
      .then((data) => { if (alive) setView({ status: "ready", data }); })
      .catch((error: unknown) => {
        if (alive) setView({ status: "error", message: error instanceof Error ? error.message : "회원 명단을 불러오지 못했습니다." });
      });
    return () => { alive = false; };
  }, [client, profile, revision]);

  return <main className={styles.page}>
    <MemberToolbar profile={profile} />
    <p className={styles.eyebrow}>ASC OPERATIONS</p>
    <h1 className={styles.title}>{view.status === "ready" && view.data.semester ? `${view.data.semester.id} 회원 관리` : "회원 관리"}</h1>
    <p className={styles.description}>로그인 아이디, 이름, 권한만 간단하게 관리합니다. 신규 회원은 현재 학기 활동·계정 활성 상태로 자동 생성됩니다.</p>

    {view.status === "loading" && <p role="status" className={styles.notice}>회원 명단을 불러오고 있습니다.</p>}
    {view.status === "error" && <section role="alert" className={styles.notice}><p>{view.message}</p><div className={styles.actions}><button className={styles.button} onClick={() => reload((value) => value + 1)}>다시 불러오기</button></div></section>}
    {view.status === "ready" && <>
      {!view.data.semester
        ? <p className={styles.notice}>현재 활동 학기가 설정되어 있지 않습니다.</p>
        : <MemberSpreadsheet records={view.data.rows} onReload={() => reload((value) => value + 1)} />}
    </>}
  </main>;
}

export default function MemberRosterPage() {
  const { state } = useMemberSession();
  return <MemberGate staffOnly>{state.status === "ready" && isActiveStaff(state.profile) && <RosterPage profile={state.profile} />}</MemberGate>;
}
