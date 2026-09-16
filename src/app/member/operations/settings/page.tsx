"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MemberGate, useMemberSession } from "@/component/member/MemberSession";
import { MemberToolbar } from "@/component/member/MemberToolbar";
import {
  createResourceLink,
  createStaffSharedSecret,
  deactivateResourceLink,
  listStaffSharedSecretAudit,
  listStaffSharedSecrets,
  readStaffPrivateSettings,
  readStaffResourceAdmin,
  reorderResourceLinks,
  revealStaffSharedSecret,
  saveStaffPrivateSettings,
  setStaffSharedSecretActive,
  updateResourceLink,
  updateStaffSharedSecret,
  type ResourceAudience,
  type ResourceCategory,
  type ResourceLink,
  type ResourceLinkDraft,
  type ResourceService,
  type StaffPrivateSettings,
  type StaffResourceAdminSnapshot,
  type StaffSharedSecret,
  type StaffSharedSecretAudit,
} from "@/lib/member-api";
import { isActiveStaff, type Profile } from "@/lib/member-domain";
import styles from "@/styles/member.module.css";

type View =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      resources: StaffResourceAdminSnapshot;
      privateSettings: StaffPrivateSettings;
      secrets: StaffSharedSecret[];
      audits: StaffSharedSecretAudit[];
    };

type LinkEditorState = {
  open: boolean;
  editing: ResourceLink | null;
  draft: ResourceLinkDraft;
};

type SecretDraft = {
  label: string;
  account_identifier: string;
  login_url: string;
  secret: string;
};

type SecretEditorState = {
  open: boolean;
  editing: StaffSharedSecret | null;
  draft: SecretDraft;
};

const REVEAL_TTL_MS = 30_000;

const SERVICE_LABELS: Record<ResourceService, string> = {
  notion: "Notion",
  google_drive: "Google Drive",
  google_docs: "Google Docs",
  google_sheets: "Google Sheets",
  google_forms: "Google Forms",
  github: "GitHub",
  discord: "Discord",
  other: "기타",
};

const CATEGORY_LABELS: Record<ResourceCategory, string> = {
  study: "스터디",
  project: "프로젝트",
  ctf: "CTF",
  recruitment: "모집",
  operations: "운영",
  other: "기타",
};

const AUDIENCE_LABELS: Record<ResourceAudience, string> = {
  member: "회원 공개",
  staff: "운영진 전용",
};

const AUDIT_LABELS: Record<StaffSharedSecretAudit["action"], string> = {
  created: "생성",
  updated: "수정",
  revealed: "조회/복사",
  deactivated: "비활성화",
  reactivated: "재활성화",
};

const emptyLinkDraft: ResourceLinkDraft = {
  title: "",
  description: "",
  url: "",
  service: "other",
  category: "other",
  audience: "member",
};

const emptySecretDraft: SecretDraft = {
  label: "",
  account_identifier: "",
  login_url: "",
  secret: "",
};

function draftFromLink(link: ResourceLink): ResourceLinkDraft {
  return {
    title: link.title,
    description: link.description,
    url: link.url,
    service: link.service,
    category: link.category,
    audience: link.audience,
  };
}

function draftFromSecret(secret: StaffSharedSecret): SecretDraft {
  return {
    label: secret.label,
    account_identifier: secret.account_identifier,
    login_url: secret.login_url ?? "",
    secret: "",
  };
}

function displayAuditTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function StaffResourceSettingsView({ profile }: { profile: Profile }) {
  const { client } = useMemberSession();
  const [view, setView] = useState<View>({ status: "loading" });
  const [staffMemo, setStaffMemo] = useState("");
  const [linkEditor, setLinkEditor] = useState<LinkEditorState>({ open: false, editing: null, draft: emptyLinkDraft });
  const [secretEditor, setSecretEditor] = useState<SecretEditorState>({ open: false, editing: null, draft: emptySecretDraft });
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const revealTimers = useRef(new Map<string, number>());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const clearRevealedSecret = useCallback((secretId: string) => {
    const timer = revealTimers.current.get(secretId);
    if (timer !== undefined) window.clearTimeout(timer);
    revealTimers.current.delete(secretId);
    setRevealed((current) => {
      if (!(secretId in current)) return current;
      const next = { ...current };
      delete next[secretId];
      return next;
    });
  }, []);

  const rememberRevealedSecret = useCallback((secretId: string, plaintext: string) => {
    const previous = revealTimers.current.get(secretId);
    if (previous !== undefined) window.clearTimeout(previous);
    setRevealed((current) => ({ ...current, [secretId]: plaintext }));
    const timer = window.setTimeout(() => clearRevealedSecret(secretId), REVEAL_TTL_MS);
    revealTimers.current.set(secretId, timer);
  }, [clearRevealedSecret]);

  useEffect(() => () => {
    for (const timer of revealTimers.current.values()) window.clearTimeout(timer);
    revealTimers.current.clear();
  }, []);

  const load = useCallback(async () => {
    if (!client) return;
    setView({ status: "loading" });
    try {
      const [resources, privateSettings, secretsResponse, auditResponse] = await Promise.all([
        readStaffResourceAdmin(client, profile),
        readStaffPrivateSettings(client, profile),
        listStaffSharedSecrets(client),
        listStaffSharedSecretAudit(client),
      ]);
      setView({
        status: "ready",
        resources,
        privateSettings,
        secrets: secretsResponse.secrets,
        audits: auditResponse.audits,
      });
      setStaffMemo(privateSettings.staff_memo);
    } catch (error) {
      setView({ status: "error", message: error instanceof Error ? error.message : "운영진 설정을 불러오지 못했습니다." });
    }
  }, [client, profile]);

  useEffect(() => { void load(); }, [load]);

  const refreshAudit = useCallback(async () => {
    if (!client) return;
    try {
      const response = await listStaffSharedSecretAudit(client);
      setView((current) => current.status === "ready" ? { ...current, audits: response.audits } : current);
    } catch {
      // Audit refresh failure must not keep a revealed secret on screen longer.
    }
  }, [client]);

  const activeLinks = useMemo(
    () => view.status === "ready" ? view.resources.links.filter((link) => link.active) : [],
    [view],
  );
  const inactiveLinks = useMemo(
    () => view.status === "ready" ? view.resources.links.filter((link) => !link.active) : [],
    [view],
  );

  const saveMemo = async () => {
    if (!client || view.status !== "ready" || busy) return;
    setBusy(true); setMessage(null);
    try {
      const response = await saveStaffPrivateSettings(client, {
        staff_memo: staffMemo,
        expected_version: view.privateSettings.version,
      });
      setView({ ...view, privateSettings: response.settings });
      setStaffMemo(response.settings.staff_memo);
      setMessage("운영진 메모를 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "운영진 메모를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const openLinkAdd = () => {
    setLinkEditor({ open: true, editing: null, draft: { ...emptyLinkDraft } });
    setMessage(null);
  };
  const openLinkEdit = (link: ResourceLink) => {
    setLinkEditor({ open: true, editing: link, draft: draftFromLink(link) });
    setMessage(null);
  };
  const closeLinkEditor = () => setLinkEditor({ open: false, editing: null, draft: { ...emptyLinkDraft } });
  const updateLinkDraft = <K extends keyof ResourceLinkDraft>(key: K, value: ResourceLinkDraft[K]) => {
    setLinkEditor((current) => ({ ...current, draft: { ...current.draft, [key]: value } }));
  };

  const saveLink = async () => {
    if (!client || busy) return;
    setBusy(true); setMessage(null);
    try {
      if (linkEditor.editing) {
        await updateResourceLink(client, {
          ...linkEditor.draft,
          resource_id: linkEditor.editing.id,
          expected_version: linkEditor.editing.version,
        });
      } else {
        await createResourceLink(client, linkEditor.draft);
      }
      const editMode = Boolean(linkEditor.editing);
      closeLinkEditor();
      await load();
      setMessage(editMode ? "자료 링크를 수정했습니다." : "자료 링크를 추가했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "자료 링크를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const removeLink = async (link: ResourceLink) => {
    if (!client || busy || !window.confirm(`'${link.title}' 링크를 삭제할까요?`)) return;
    setBusy(true); setMessage(null);
    try {
      await deactivateResourceLink(client, { resource_id: link.id, expected_version: link.version });
      await load();
      setMessage("자료 링크를 삭제했습니다. 기록은 비활성 상태로 보존됩니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "자료 링크를 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const moveLink = async (link: ResourceLink, delta: -1 | 1) => {
    if (!client || busy) return;
    const index = activeLinks.findIndex((candidate) => candidate.id === link.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= activeLinks.length) return;
    const reordered = [...activeLinks];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setBusy(true); setMessage(null);
    try {
      await reorderResourceLinks(client, reordered.map((item) => item.id));
      await load();
      setMessage("링크 순서를 변경했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "링크 순서를 변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const openSecretAdd = () => {
    setSecretEditor({ open: true, editing: null, draft: { ...emptySecretDraft } });
    setMessage(null);
  };

  const openSecretEdit = (secret: StaffSharedSecret) => {
    clearRevealedSecret(secret.id);
    setSecretEditor({ open: true, editing: secret, draft: draftFromSecret(secret) });
    setMessage(null);
  };

  const closeSecretEditor = () => setSecretEditor({ open: false, editing: null, draft: { ...emptySecretDraft } });
  const updateSecretDraft = <K extends keyof SecretDraft>(key: K, value: SecretDraft[K]) => {
    setSecretEditor((current) => ({ ...current, draft: { ...current.draft, [key]: value } }));
  };

  const saveSecret = async () => {
    if (!client || busy) return;
    setBusy(true); setMessage(null);
    try {
      const draft = {
        label: secretEditor.draft.label,
        account_identifier: secretEditor.draft.account_identifier,
        login_url: secretEditor.draft.login_url.trim() || null,
        secret: secretEditor.draft.secret,
      };
      if (secretEditor.editing) {
        clearRevealedSecret(secretEditor.editing.id);
        await updateStaffSharedSecret(client, {
          ...draft,
          secret_id: secretEditor.editing.id,
          expected_version: secretEditor.editing.version,
        });
      } else {
        await createStaffSharedSecret(client, draft);
      }
      const editMode = Boolean(secretEditor.editing);
      closeSecretEditor();
      await load();
      setMessage(editMode ? "공용 계정을 수정했습니다." : "공용 계정을 추가했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "공용 계정을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const revealSecret = async (secret: StaffSharedSecret) => {
    if (!client || busy || !secret.active) return;
    if (revealed[secret.id]) {
      clearRevealedSecret(secret.id);
      return;
    }
    setBusy(true); setMessage(null);
    try {
      const response = await revealStaffSharedSecret(client, secret.id);
      rememberRevealedSecret(secret.id, response.secret);
      await refreshAudit();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "비밀정보를 확인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async (secret: StaffSharedSecret) => {
    if (!client || busy || !secret.active) return;
    setBusy(true); setMessage(null);
    try {
      const response = await revealStaffSharedSecret(client, secret.id);
      await navigator.clipboard.writeText(response.secret);
      clearRevealedSecret(secret.id);
      await refreshAudit();
      setMessage("비밀정보를 클립보드에 복사했습니다. 운영체제의 클립보드 기록은 ASC에서 지울 수 없습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "비밀정보를 복사하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const toggleSecretActive = async (secret: StaffSharedSecret) => {
    if (!client || busy) return;
    if (secret.active && !window.confirm(`'${secret.label}' 공용 계정을 비활성화할까요?`)) return;
    clearRevealedSecret(secret.id);
    setBusy(true); setMessage(null);
    try {
      await setStaffSharedSecretActive(client, {
        secret_id: secret.id,
        expected_version: secret.version,
        active: !secret.active,
      });
      await load();
      setMessage(secret.active ? "공용 계정을 비활성화했습니다." : "공용 계정을 재활성화했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "공용 계정 상태를 변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return <main className={styles.page}>
    <MemberToolbar profile={profile} />
    <p className={styles.eyebrow}>ASC STAFF SETTINGS</p>
    <h1 className={styles.title}>운영진 설정</h1>
    <p className={styles.description}>인수인계 메모, 외부 자료 링크, 운영진 공용 계정을 한 곳에서 관리합니다.</p>

    {view.status === "loading" && <p className={styles.notice}>운영진 설정을 불러오고 있습니다.</p>}
    {view.status === "error" && <section className={styles.notice} role="alert"><p>{view.message}</p><button className={styles.button} onClick={() => void load()}>다시 불러오기</button></section>}

    {view.status === "ready" && <>
      <section className={styles.formCard}>
        <h2>운영진 메모</h2>
        <p className={styles.helper}>Google 계정, Instagram, GitHub 등 비밀이 아닌 인수인계 정보를 적어두세요. <strong>비밀번호/토큰은 메모에 적지 말고 아래 공용 계정 / 비밀정보에 저장하세요.</strong></p>
        <label className={styles.field}>메모
          <textarea rows={8} maxLength={20000} value={staffMemo} onChange={(event) => setStaffMemo(event.target.value)} placeholder={"Google: asc.operations@gmail.com\nInstagram: @ssu_asc\nGitHub: ssu-asc\n기타 인수인계 메모"} />
        </label>
        <div className={styles.actions}><button className={styles.button} disabled={busy} onClick={() => void saveMemo()}>{busy ? "저장 중…" : "메모 저장"}</button></div>
      </section>

      <section className={styles.scheduleSection}>
        <div className={styles.headingRow}>
          <div><h2>링크 모음</h2><p className={styles.helper}>기존 Notion 스터디 자료도 옮기지 말고 링크로 등록하세요. 회원 공개 링크는 회원 자료실에 나타나고 운영진 전용 링크는 이 화면에만 보입니다.</p></div>
          <button className={styles.button} type="button" onClick={openLinkAdd}>링크 추가</button>
        </div>

        {activeLinks.length === 0 ? <p className={styles.notice}>등록된 활성 링크가 없습니다.</p> : <div className={styles.scheduleList}>{activeLinks.map((link, index) => <article key={link.id}>
          <div>
            <div className={styles.actions}>
              <span className={styles.scheduleCategory}>{SERVICE_LABELS[link.service]}</span>
              <span className={styles.scheduleCategory}>{CATEGORY_LABELS[link.category]}</span>
              <span className={styles.scheduleCategory}>{AUDIENCE_LABELS[link.audience]}</span>
            </div>
            <strong>{link.title}</strong>
            {link.description && <p>{link.description}</p>}
          </div>
          <div className={styles.actions}>
            <a className={styles.textLink} href={link.url} target="_blank" rel="noopener noreferrer">열기 ↗</a>
            <button className={styles.smallButton} type="button" disabled={busy || index === 0} onClick={() => void moveLink(link, -1)}>위로</button>
            <button className={styles.smallButton} type="button" disabled={busy || index === activeLinks.length - 1} onClick={() => void moveLink(link, 1)}>아래로</button>
            <button className={styles.smallButton} type="button" disabled={busy} onClick={() => openLinkEdit(link)}>수정</button>
            <button className={styles.dangerButton} type="button" disabled={busy} onClick={() => void removeLink(link)}>삭제</button>
          </div>
        </article>)}</div>}
      </section>

      {inactiveLinks.length > 0 && <section className={styles.scheduleSection}>
        <h2>비활성화된 링크</h2>
        <div className={styles.scheduleList}>{inactiveLinks.map((link) => <article key={link.id}>
          <div><span className={styles.scheduleCategory}>{SERVICE_LABELS[link.service]}</span><strong>{link.title}</strong><p>비활성</p></div>
        </article>)}</div>
      </section>}

      {linkEditor.open && <section className={styles.formCard}>
        <div className={styles.headingRow}><h2>{linkEditor.editing ? "링크 수정" : "링크 추가"}</h2><button className={styles.smallButton} type="button" onClick={closeLinkEditor}>닫기</button></div>
        <div className={styles.formGrid}>
          <label className={styles.field}>제목<input value={linkEditor.draft.title} maxLength={120} onChange={(event) => updateLinkDraft("title", event.target.value)} placeholder="예: 웹해킹 스터디" /></label>
          <label className={styles.field}>URL<input value={linkEditor.draft.url} onChange={(event) => updateLinkDraft("url", event.target.value)} placeholder="https://" /></label>
          <label className={styles.field}>서비스<select value={linkEditor.draft.service} onChange={(event) => updateLinkDraft("service", event.target.value as ResourceService)}>
            {(Object.entries(SERVICE_LABELS) as Array<[ResourceService, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label className={styles.field}>분류<select value={linkEditor.draft.category} onChange={(event) => updateLinkDraft("category", event.target.value as ResourceCategory)}>
            {(Object.entries(CATEGORY_LABELS) as Array<[ResourceCategory, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label className={styles.field}>공개 범위<select value={linkEditor.draft.audience} onChange={(event) => updateLinkDraft("audience", event.target.value as ResourceAudience)}>
            <option value="member">회원 공개</option><option value="staff">운영진 전용</option>
          </select></label>
        </div>
        <label className={styles.field}>설명<textarea rows={4} maxLength={1000} value={linkEditor.draft.description} onChange={(event) => updateLinkDraft("description", event.target.value)} placeholder="선택 · 자료 용도나 범위를 적어두세요." /></label>
        <div className={styles.actions}><button className={styles.button} type="button" disabled={busy} onClick={() => void saveLink()}>{busy ? "저장 중…" : linkEditor.editing ? "수정 저장" : "링크 추가"}</button><button className={styles.smallButton} type="button" onClick={closeLinkEditor}>취소</button></div>
      </section>}

      <section className={styles.scheduleSection}>
        <div className={styles.headingRow}>
          <div><h2>공용 계정 / 비밀정보</h2><p className={styles.helper}>비밀번호/토큰은 Supabase Vault에 암호화 저장되며 목록을 불러올 때는 복호화하지 않습니다. `보기` 후 30초가 지나면 화면에서 자동으로 지웁니다.</p></div>
          <button className={styles.button} type="button" onClick={openSecretAdd}>공용 계정 추가</button>
        </div>

        {view.secrets.length === 0 ? <p className={styles.notice}>등록된 공용 계정이 없습니다.</p> : <div className={styles.scheduleList}>{view.secrets.map((secret) => <article key={secret.id}>
          <div>
            <div className={styles.actions}>{!secret.active && <span className={styles.scheduleCategory}>비활성</span>}</div>
            <strong>{secret.label}</strong>
            {secret.account_identifier && <p>{secret.account_identifier}</p>}
            <p><code>{revealed[secret.id] ?? "••••••••••••"}</code></p>
          </div>
          <div className={styles.actions}>
            {secret.login_url && <a className={styles.textLink} href={secret.login_url} target="_blank" rel="noopener noreferrer">로그인 ↗</a>}
            {secret.active && <button className={styles.smallButton} type="button" disabled={busy} onClick={() => void revealSecret(secret)}>{revealed[secret.id] ? "숨기기" : "보기"}</button>}
            {secret.active && <button className={styles.smallButton} type="button" disabled={busy} onClick={() => void copySecret(secret)}>복사</button>}
            <button className={styles.smallButton} type="button" disabled={busy} onClick={() => openSecretEdit(secret)}>수정</button>
            <button className={secret.active ? styles.dangerButton : styles.smallButton} type="button" disabled={busy} onClick={() => void toggleSecretActive(secret)}>{secret.active ? "비활성화" : "재활성화"}</button>
          </div>
        </article>)}</div>}
        <p className={styles.helper}>복사한 값은 운영체제 클립보드 기록에 남을 수 있으며 ASC_WEB에서 원격으로 지울 수 없습니다.</p>
      </section>

      {secretEditor.open && <section className={styles.formCard}>
        <div className={styles.headingRow}><h2>{secretEditor.editing ? "공용 계정 수정" : "공용 계정 추가"}</h2><button className={styles.smallButton} type="button" onClick={closeSecretEditor}>닫기</button></div>
        <div className={styles.formGrid}>
          <label className={styles.field}>이름<input maxLength={100} value={secretEditor.draft.label} onChange={(event) => updateSecretDraft("label", event.target.value)} placeholder="예: ASC Google" /></label>
          <label className={styles.field}>계정 / 아이디<input maxLength={320} value={secretEditor.draft.account_identifier} onChange={(event) => updateSecretDraft("account_identifier", event.target.value)} placeholder="asc.operations@gmail.com" /></label>
          <label className={styles.field}>로그인 주소 <span className={styles.secondary}>선택</span><input value={secretEditor.draft.login_url} onChange={(event) => updateSecretDraft("login_url", event.target.value)} placeholder="https://" /></label>
          <label className={styles.field}>비밀번호 / 비밀값<input type="password" autoComplete="new-password" maxLength={2048} value={secretEditor.draft.secret} onChange={(event) => updateSecretDraft("secret", event.target.value)} placeholder={secretEditor.editing ? "비워두면 기존 값 유지" : "비밀값 입력"} /></label>
        </div>
        <div className={styles.actions}><button className={styles.button} type="button" disabled={busy} onClick={() => void saveSecret()}>{busy ? "저장 중…" : secretEditor.editing ? "수정 저장" : "공용 계정 추가"}</button><button className={styles.smallButton} type="button" onClick={closeSecretEditor}>취소</button></div>
      </section>}

      <section className={styles.scheduleSection}>
        <h2>최근 비밀정보 접근 기록</h2>
        {view.audits.length === 0 ? <p className={styles.helper}>아직 기록이 없습니다.</p> : <div className={styles.scheduleList}>{view.audits.map((audit) => <article key={audit.id}>
          <div><strong>{AUDIT_LABELS[audit.action]}</strong><p>{audit.actor_name ?? "알 수 없는 운영진"}{audit.actor_member_id ? ` · ${audit.actor_member_id}` : ""}</p></div>
          <span className={styles.secondary}>{displayAuditTime(audit.created_at)}</span>
        </article>)}</div>}
      </section>

      {message && <p className={styles.notice} role="status">{message}</p>}

      <section className={styles.scheduleSection}>
        <h2>인수인계 주의사항</h2>
        <p className={styles.helper}>외부 서비스의 공유/소유권은 각 서비스에서 별도로 관리해야 합니다. 비밀정보 조회 권한을 가진 운영진 세션이 탈취되면 Vault 암호화만으로 조회를 막을 수 없으므로 운영진 계정 자체도 안전하게 관리하세요.</p>
      </section>
    </>}
  </main>;
}

export default function StaffResourceSettingsPage() {
  const { state } = useMemberSession();
  return <MemberGate staffOnly>{state.status === "ready" && isActiveStaff(state.profile) && <StaffResourceSettingsView profile={state.profile} />}</MemberGate>;
}
