'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/AuthGuard';
import { AccountShell } from '@/components/AccountShell';
import { auth } from '@/lib/firebase/config';
import type { User } from 'firebase/auth';

function DeleteAccount({ user }: { user: User }) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const REQUIRED = '削除します';

  async function doDelete() {
    if (confirmText !== REQUIRED) {
      setError(`確認文字列が一致しません (「${REQUIRED}」と入力)`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const apiBase =
        process.env.NEXT_PUBLIC_NOXA_FUNCTIONS_URL ??
        'https://asia-northeast1-minami-bar-guide.cloudfunctions.net';
      const res = await fetch(`${apiBase}/deleteNoxaAccount`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      await auth.signOut();
      router.replace('/?deleted=1');
    } catch (e) {
      console.error(e);
      setError('退会処理に失敗しました。サポートまでお問い合わせください');
      setSubmitting(false);
    }
  }

  return (
    <AccountShell user={user}>
      <div className="noxa-eyebrow" style={{ marginBottom: 10, color: 'var(--noxa-accent-destructive)' }}>
        Account · Delete
      </div>
      <h1
        className="noxa-h1"
        style={{ color: 'var(--noxa-accent-destructive)', margin: '0 0 32px' }}
      >
        Noxa アカウント削除
      </h1>

      <div
        className="flex flex-col"
        style={{
          background: 'rgba(196, 56, 74, 0.08)',
          border: '1px solid rgba(196, 56, 74, 0.30)',
          borderRadius: 'var(--noxa-radius-lg)',
          padding: 24,
          gap: 16,
          maxWidth: 720,
        }}
      >
        <p style={{ color: 'var(--noxa-accent-destructive)', fontSize: 14, fontWeight: 500, margin: 0 }}>
          以下のデータがすべて完全削除されます（取り消し不可）:
        </p>
        <ul
          style={{
            color: 'var(--noxa-text-primary)',
            fontSize: 14,
            lineHeight: 1.8,
            margin: 0,
            paddingLeft: 0,
            listStyle: 'none',
          }}
        >
          <li>✗ yorulog の顧客カルテ・売上記録・AI スレッド</li>
          <li>✗ nomishugy のお気に入り・チェックイン・レビュー</li>
          <li>✗ Noxa コミュニティの投稿・コメント・いいね</li>
          <li>✗ AI クレジット残高・サブスクリプション</li>
          <li>✗ アカウント情報・認証情報</li>
        </ul>
        <p style={{ color: 'var(--noxa-text-muted)', fontSize: 12, margin: 0, lineHeight: 1.65 }}>
          ※ 店舗オーナーとして登録した店舗データは、別オーナーに譲渡するか同時に削除されます。
          法律で保管義務のあるデータ（決済記録等）は匿名化のうえ法定期間保持します。
        </p>
      </div>

      <div className="flex flex-col" style={{ marginTop: 24, gap: 16, maxWidth: 720 }}>
        <label>
          <span className="noxa-label">
            確認のため「{REQUIRED}」と入力してください:
          </span>
          <input
            type="text"
            className="noxa-input"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            aria-invalid={!!error}
          />
        </label>
        {error && (
          <p style={{ color: 'var(--noxa-accent-destructive)', fontSize: 13, margin: 0 }}>
            {error}
          </p>
        )}
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => router.push('/account')}
            className="noxa-btn noxa-btn-secondary"
            style={{ padding: '12px 24px', fontSize: 14 }}
          >
            キャンセル
          </button>
          <button
            onClick={doDelete}
            disabled={submitting || confirmText !== REQUIRED}
            className="noxa-btn noxa-btn-destructive"
            style={{ padding: '12px 24px', fontSize: 14 }}
          >
            {submitting ? '削除中…' : 'Noxa アカウントを完全削除'}
          </button>
        </div>
      </div>
    </AccountShell>
  );
}

export default function DeletePage() {
  return <AuthGuard>{(user) => <DeleteAccount user={user} />}</AuthGuard>;
}
