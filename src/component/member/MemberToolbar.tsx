"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemberSession } from "./MemberSession";
import { isActiveStaff, type Profile } from "@/lib/member-domain";
import styles from "@/styles/member.module.css";

export function MemberToolbar({ profile }: { profile: Profile }) {
  const { signOut } = useMemberSession();
  const pathname = usePathname();
  const current = (path: string) => pathname.replace(/\/$/, "") === path ? "page" as const : undefined;
  const staff = isActiveStaff(profile);

  return <div className={styles.toolbar}>
    <p className={styles.identity}><strong>{profile.name}</strong>{profile.member_id}</p>
    <nav className={styles.nav} aria-label="회원 메뉴">
      {staff ? <>
        <Link href="/member/operations/progress" aria-current={current("/member/operations/progress")}>전체 현황</Link>
        <Link href="/member/operations/submissions" aria-current={current("/member/operations/submissions")}>회차별 현황</Link>
        <Link href="/member/operations/teams" aria-current={current("/member/operations/teams")}>팀 관리</Link>
        <Link href="/member/operations/members" aria-current={current("/member/operations/members")}>회원 관리</Link>
        <Link href="/member/resources" aria-current={current("/member/resources")}>자료실</Link>
        <Link href="/member/schedule" aria-current={current("/member/schedule")}>일정</Link>
        <Link href="/member/operations/settings" aria-current={current("/member/operations/settings")}>운영진 설정</Link>
      </> : <>
        <Link href="/member" aria-current={current("/member")}>내 프로젝트</Link>
        <Link href="/member/resources" aria-current={current("/member/resources")}>자료실</Link>
        <Link href="/member/schedule" aria-current={current("/member/schedule")}>일정</Link>
      </>}
      <Link href="/member/password" aria-current={current("/member/password")}>비밀번호</Link>
      <button className={styles.button} onClick={() => void signOut()}>로그아웃</button>
    </nav>
  </div>;
}
