'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/AuthGuard';
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
      const apiBase = process.env.NEXT_PUBLIC_NOXA_FUNCTIONS_URL
        ?? 'https://asia-northeast1-minami-bar-guide.cloudfunctions.net';
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
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/account" className="mb-6 inline-block text-sm text-zinc-400 hover:text-zinc-200">← NOXA Account</Link>
      <h1 className="mb-8 text-2xl font-bold text-rose-400">NOXA アカウント削除</h1>

      <div className="space-y-4 rounded-2xl border border-rose-900/50 bg-rose-950/20 p-6">
        <p className="text-sm font-medium text-rose-300">
          以下のデータがすべて完全削除されます（取り消し不可）:
        </p>
        <ul className="space-y-1.5 text-sm text-zinc-300">
          <li>✗ yorulog の顧客カルテ・売上記録・AI スレッド</li>
          <li>✗ nomishugy のお気に入り・チェックイン・レビュー</li>
          <li>✗ NOXA コミュニティの投稿・コメント・いいね</li>
          <li>✗ AI クレジット残高・サブスクリプション</li>
          <li>✗ アカウント情報・認証情報</li>
        </ul>
        <p className="pt-2 text-xs text-zinc-500">
          ※ 店舗オーナーとして登録した店舗データは、別オーナーに譲渡するか同時に削除されます。
          法律で保管義務のあるデータ（決済記録等）は匿名化のうえ法定期間保持します。
        </p>
      </div>

      <div className="mt-6 space-y-3">
        <label className="block text-sm text-zinc-300">
          確認のため「{REQUIRED}」と入力してください:
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm focus:border-rose-500 focus:outline-none"
          />
        </label>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <div className="flex gap-3">
          <Link
            href="/account"
            className="rounded-lg border border-zinc-700 bg-transparent px-6 py-2.5 text-sm font-medium transition hover:border-zinc-500"
          >
            キャンセル
          </Link>
          <button
            onClick={doDelete}
            disabled={submitting || confirmText !== REQUIRED}
            className="rounded-lg bg-rose-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-rose-500 disabled:opacity-50"
          >
            {submitting ? '削除中…' : 'NOXA アカウントを完全削除'}
          </button>
        </div>
      </div>
    </main>
  );
}

export default function DeletePage() {
  return <AuthGuard>{(user) => <DeleteAccount user={user} />}</AuthGuard>;
}
