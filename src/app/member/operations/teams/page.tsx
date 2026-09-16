"use client";

import { useEffect, useMemo, useState } from "react";
import { MemberGate, useMemberSession } from "@/component/member/MemberSession";
import { MemberToolbar } from "@/component/member/MemberToolbar";
import { manageTeam, readTeamAdminSnapshot, type TeamAdminSnapshot } from "@/lib/member-api";
import { isActiveStaff, type Profile, type Team } from "@/lib/member-domain";
import styles from "@/styles/member.module.css";

type View =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: TeamAdminSnapshot };

function TeamCard({ team, memberNames, onReload }: { team: Team; memberNames: string[]; onReload: () => void }) {
  const { client } = useMemberSession();
  const [name, setName] = useState(team.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const rename = async () => {
    if (!client || !name.trim()) return;
    setBusy(true); setMessage(null);
    try {
      await manageTeam(client, { action: "rename_team", team_id: team.id, expected_version: team.version, name });
      onReload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "팀 이름을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!client || memberNames.length > 0 || !window.confirm(`'${team.name}' 팀을 삭제할까요?`)) return;
    setBusy(true); setMessage(null);
    try {
      await manageTeam(client, { action: "delete_team", team_id: team.id, expected_version: team.version });
      onReload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "팀을 삭제하지 못했습니다.");
    } finally { setBusy(false); }
  };

  return <article className={styles.card}>
    <span className={styles.badge}>{memberNames.length}명</span>
    <label className={styles.field}>팀 이름
      <input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
    </label>
    <div className={styles.memberChips}>
      {memberNames.length > 0 ? memberNames.map((member) => <span key={member}>{member}</span>) : <span>배정된 회원 없음</span>}
    </div>
    {message && <p className={styles.helper} role="status">{message}</p>}
    <div className={styles.actions}>
      <button className={styles.smallButton} disabled={busy || name.trim() === team.name} onClick={() => void rename()}>이름 저장</button>
      {memberNames.length === 0 && <button className={styles.dangerButton} disabled={busy} onClick={() => void remove()}>팀 삭제</button>}
    </div>
  </article>;
}

function TeamOperations({ profile }: { profile: Profile }) {
  const { client } = useMemberSession();
  const [view, setView] = useState<View>({ status: "loading" });
  const [revision, reload] = useState(0);
  const [newName, setNewName] = useState("");
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    setView({ status: "loading" });
    void readTeamAdminSnapshot(client, profile)
      .then((data) => { if (alive) setView({ status: "ready", data }); })
      .catch((error: unknown) => { if (alive) setView({ status: "error", message: error instanceof Error ? error.message : "팀 정보를 불러오지 못했습니다." }); });
    return () => { alive = false; };
  }, [client, profile, revision]);

  const memberRows = useMemo(() => {
    if (view.status !== "ready") return [];
    const linkByProfile = new Map(view.data.teamMembers.map((link) => [link.profile_id, link.team_id]));
    return view.data.members
      .filter((row) => row.profile.role === "member" && row.profile.active && row.membership.active)
      .map((row) => ({ ...row, teamId: linkByProfile.get(row.profile.id) ?? null }));
  }, [view]);

  const teamMemberNames = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const row of memberRows) {
      if (!row.teamId) continue;
      result.set(row.teamId, [...(result.get(row.teamId) ?? []), `${row.profile.name} · ${row.profile.member_id}`]);
    }
    return result;
  }, [memberRows]);

  const createTeam = async () => {
    if (!client || !newName.trim()) return;
    setCreateBusy(true); setMessage(null);
    try {
      await manageTeam(client, { action: "create_team", name: newName });
      setNewName(""); reload((value) => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "팀을 만들지 못했습니다."); }
    finally { setCreateBusy(false); }
  };

  const changeTeam = async (profileId: string, currentTeamId: string | null, targetTeamId: string) => {
    if (!client || targetTeamId === (currentTeamId ?? "")) return;
    setBusyProfileId(profileId); setMessage(null);
    try {
      if (targetTeamId) {
        await manageTeam(client, { action: "assign_member", team_id: targetTeamId, profile_id: profileId, expected_team_id: currentTeamId });
      } else if (currentTeamId) {
        await manageTeam(client, { action: "remove_member", team_id: currentTeamId, profile_id: profileId, expected_team_id: currentTeamId });
      }
      reload((value) => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "팀 배정을 변경하지 못했습니다."); }
    finally { setBusyProfileId(null); }
  };

  return <main className={styles.page}>
    <MemberToolbar profile={profile} />
    <p className={styles.eyebrow}>ASC TEAM OPERATIONS</p>
    <div className={styles.headingRow}>
      <div>
        <h1 className={styles.title}>{view.status === "ready" && view.data.semester ? `${view.data.semester.id} 팀 관리` : "팀 관리"}</h1>
        <p className={styles.description}>팀은 학기 동안 고정됩니다. 운영진이 여기서 편성한 팀이 모든 팀 프로젝트에 사용됩니다.</p>
      </div>
    </div>

    <section className={styles.formCard}>
      <h2>팀 만들기</h2>
      <div className={styles.formGrid}>
        <label className={styles.field}>팀 이름<input value={newName} maxLength={100} onChange={(event) => setNewName(event.target.value)} placeholder="예: 1팀" /></label>
      </div>
      <div className={styles.actions}><button className={styles.button} disabled={createBusy || !newName.trim()} onClick={() => void createTeam()}>팀 만들기</button></div>
    </section>

    {message && <p className={styles.notice} role="status">{message}</p>}
    {view.status === "loading" && <p className={styles.notice} role="status">팀 정보를 불러오고 있습니다.</p>}
    {view.status === "error" && <section className={styles.notice} role="alert"><p>{view.message}</p><button className={styles.button} onClick={() => reload((value) => value + 1)}>다시 불러오기</button></section>}
    {view.status === "ready" && <>
      <section className={styles.scheduleSection}>
        <h2>학기 팀</h2>
        {view.data.teams.length === 0 ? <p className={styles.helper}>아직 만들어진 팀이 없습니다.</p> : <div className={styles.cards}>
          {view.data.teams.map((team) => <TeamCard key={team.id} team={team} memberNames={teamMemberNames.get(team.id) ?? []} onReload={() => reload((value) => value + 1)} />)}
        </div>}
      </section>

      <section className={styles.scheduleSection}>
        <h2>회원 배정</h2>
        <p className={styles.helper}>부원 한 명은 한 학기에 한 팀만 소속될 수 있습니다. 다른 팀을 선택하면 바로 이동합니다.</p>
        {memberRows.length === 0 ? <p className={styles.notice}>배정할 활동 부원이 없습니다.</p> : <div className={styles.tableWrap}><table className={styles.roster}>
          <thead><tr><th>회원</th><th>아이디</th><th>현재 팀</th><th>배정</th></tr></thead>
          <tbody>{memberRows.map((row) => <tr key={row.profile.id}>
            <td data-label="회원"><strong>{row.profile.name}</strong></td>
            <td data-label="아이디">{row.profile.member_id}</td>
            <td data-label="현재 팀">{view.data.teams.find((team) => team.id === row.teamId)?.name ?? <span className={styles.secondary}>미배정</span>}</td>
            <td data-label="배정">
              <select
                aria-label={`${row.profile.name} 팀 배정`}
                value={row.teamId ?? ""}
                disabled={busyProfileId === row.profile.id}
                onChange={(event) => void changeTeam(row.profile.id, row.teamId, event.target.value)}
              >
                <option value="">미배정</option>
                {view.data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </td>
          </tr>)}</tbody>
        </table></div>}
      </section>
    </>}
  </main>;
}

export default function TeamOperationsPage() {
  const { state } = useMemberSession();
  return <MemberGate staffOnly>{state.status === "ready" && isActiveStaff(state.profile) && <TeamOperations profile={state.profile} />}</MemberGate>;
}
