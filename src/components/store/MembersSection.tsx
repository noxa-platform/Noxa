'use client';

/**
 * 店舗設定 > メンバー管理セクション（owner/manager 用）。
 * - メンバー一覧（role 変更 / 除名）
 * - 招待コードの発行（role 指定・7日失効・1回使い切り）と発行済み一覧・取消
 * 招待の受諾は /store/join?shop=&code=（redeem API が members 登録＋席回し名簿と紐付け）。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/config';
import { isInviteExpired } from '@/lib/invite-expiry';

type Member = { uid: string; role: string; castDisplayName?: string; kind?: string; status?: string };
type Invite = { code: string; role: string; createdBy?: string; expiresAt?: Timestamp; usedBy?: string };

const ROLE_LABELS: Record<string, string> = {
  owner: 'オーナー', manager: '店長', cast: 'キャスト', accounting: '会計（レジ）',
};
const INVITE_ROLES = [
  { value: 'cast', label: 'キャスト' },
  { value: 'manager', label: '店長' },
  { value: 'accounting', label: '会計（レジ）' },
];

export function MembersSection({ shopId, myUid }: { shopId: string; myUid: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteRole, setInviteRole] = useState('cast');
  const [issuing, setIssuing] = useState(false);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, `shop_shops/${shopId}/members`), (snap) => {
        const list: Member[] = [];
        snap.forEach((d) => list.push({ uid: d.id, ...(d.data() as Omit<Member, 'uid'>) }));
        // owner → manager → cast → accounting(端末) の順
        const order = ['owner', 'manager', 'cast', 'accounting'];
        list.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
        setMembers(list);
      }, (e) => setError(`メンバー一覧の取得に失敗: ${e.message}`)),
      onSnapshot(collection(db, `shop_shops/${shopId}/invites`), (snap) => {
        const list: Invite[] = [];
        snap.forEach((d) => list.push({ code: d.id, ...(d.data() as Omit<Invite, 'code'>) }));
        setInvites(list.filter((i) => !i.usedBy));
      }, () => { /* 権限なし(非owner)は招待一覧非表示のまま */ }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [shopId]);

  const issueInvite = async () => {
    setIssuing(true); setError(null); setLastUrl(null);
    try {
      const token = await auth?.currentUser?.getIdToken();
      const res = await fetch('/api/team/issue-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ shopId, role: inviteRole }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '発行に失敗しました');
      setLastUrl(json.url);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setIssuing(false);
    }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); window.alert('コピーしました'); } catch { /* noop */ }
  };

  const changeRole = async (uid: string, role: string) => {
    try {
      await setDoc(doc(db, `shop_shops/${shopId}/members/${uid}`), { role, updatedAt: serverTimestamp() }, { merge: true });
    } catch (e) { setError(String((e as Error)?.message ?? e)); }
  };

  const removeMember = async (m: Member) => {
    if (!window.confirm(`${m.castDisplayName || m.uid} をメンバーから外しますか？`)) return;
    try { await deleteDoc(doc(db, `shop_shops/${shopId}/members/${m.uid}`)); } catch (e) { setError(String((e as Error)?.message ?? e)); }
  };

  const cancelInvite = async (code: string) => {
    // 共有済みコードの誤取消防止（取り消すと相手側で無効になる）
    if (!window.confirm(`招待コード ${code} を取り消しますか？送付済みの場合、相手は参加できなくなります。`)) return;
    try { await deleteDoc(doc(db, `shop_shops/${shopId}/invites/${code}`)); } catch (e) { setError(String((e as Error)?.message ?? e)); }
  };

  const inviteUrl = (code: string) => `${window.location.origin}/store/join?shop=${encodeURIComponent(shopId)}&code=${encodeURIComponent(code)}`;

  const humans = useMemo(() => members.filter((m) => m.kind !== 'device'), [members]);
  const devices = useMemo(() => members.filter((m) => m.kind === 'device'), [members]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {error && <p style={{ color: 'var(--noxa-status-error)', fontSize: 12, margin: 0 }}>{error}</p>}

      {/* メンバー一覧 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {humans.map((m) => (
          <div key={m.uid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--noxa-bg-base)', border: '1px solid var(--noxa-border)' }}>
            <span style={{ flex: 1, fontSize: 13 }}>{m.castDisplayName || m.uid}{m.uid === myUid && <span style={{ color: 'var(--noxa-text-faint)', fontSize: 11 }}>（自分）</span>}</span>
            {m.role === 'owner' ? (
              <span style={{ fontSize: 12, color: 'var(--noxa-accent-primary-ink)' }}>オーナー</span>
            ) : (
              <>
                <select value={m.role} onChange={(e) => changeRole(m.uid, e.target.value)} className="noxa-input" style={{ width: 130, fontSize: 12 }}>
                  {INVITE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <button type="button" onClick={() => removeMember(m)} style={miniBtn}>外す</button>
              </>
            )}
          </div>
        ))}
        {humans.length === 0 && <p style={{ fontSize: 12, color: 'var(--noxa-text-faint)', margin: 0 }}>メンバーはまだいません。下の招待リンクから追加できます。</p>}
        {devices.length > 0 && (
          <p style={{ fontSize: 11, color: 'var(--noxa-text-faint)', margin: '2px 0 0' }}>共有端末ログイン: {devices.length} 台（{devices.map((d) => (d as { label?: string }).label ?? d.uid).join(' / ')}）</p>
        )}
      </div>

      {/* 招待発行 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="noxa-input" style={{ width: 150 }}>
          {INVITE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <button type="button" onClick={issueInvite} disabled={issuing} className="noxa-btn noxa-btn-primary" style={{ padding: '8px 18px', fontSize: 13 }}>
          {issuing ? '発行中…' : '招待リンクを発行'}
        </button>
      </div>
      {lastUrl && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: 'rgba(123,232,161,0.08)', border: '1px solid var(--noxa-border)' }}>
          <code style={{ flex: 1, fontSize: 11, wordBreak: 'break-all' }}>{lastUrl}</code>
          <button type="button" onClick={() => copy(lastUrl)} style={miniBtn}>コピー</button>
        </div>
      )}

      {/* 発行済み（未使用）招待 */}
      {invites.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}>未使用の招待（7日で失効）</span>
          {invites.map((i) => {
            // 失効済みのコードを「使える招待」として並べると、送った側は原因不明の
            // 参加失敗として跳ね返ってくる。期限を明示し、リンクのコピーも出さない。
            const expired = isInviteExpired(i.expiresAt);
            return (
              <div key={i.code} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: expired ? 0.55 : 1 }}>
                <code style={{ color: 'var(--noxa-text-muted)' }}>{i.code}</code>
                <span style={{ color: 'var(--noxa-text-faint)' }}>{ROLE_LABELS[i.role] ?? i.role}</span>
                {expired
                  ? <span style={{ color: 'var(--noxa-status-error)' }}>期限切れ</span>
                  : <button type="button" onClick={() => copy(inviteUrl(i.code))} style={miniBtn}>リンク</button>}
                <button type="button" onClick={() => cancelInvite(i.code)} style={{ ...miniBtn, color: 'var(--noxa-status-error)' }}>取消</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const miniBtn: React.CSSProperties = { padding: '5px 10px', borderRadius: 8, background: 'transparent', border: '1px solid var(--noxa-border)', color: 'var(--noxa-text-muted)', fontSize: 11, cursor: 'pointer', flex: 'none' };
