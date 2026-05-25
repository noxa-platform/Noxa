import Link from 'next/link';

const PRODUCTS = [
  {
    id: 'yorulog',
    name: 'yorulog',
    nameJa: 'ヨルログ',
    desc: 'ホスト / キャバ / ラウンジ嬢の売上・顧客管理 CRM',
    url: 'https://yorulog.vercel.app',
    accent: 'from-violet-500/30 to-fuchsia-500/10',
  },
  {
    id: 'nomishugy',
    name: 'nomishugy',
    nameJa: 'のみしゅぎ',
    desc: 'ミナミのバーポータル + 飲み仲間マッチング + バー求人',
    url: 'https://nomishugy.vercel.app',
    accent: 'from-amber-500/30 to-rose-500/10',
  },
  {
    id: 'community',
    name: 'NOXA Community',
    nameJa: 'NOXA コミュニティ',
    desc: '夜の街で働く / 遊ぶ人たちの交流掲示板（近日公開）',
    url: '/community',
    accent: 'from-emerald-500/30 to-cyan-500/10',
    soon: true,
  },
];

export default function NoxaLandingPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="mb-16 text-center">
        <h1 className="mb-3 text-6xl font-black tracking-tight">NOXA</h1>
        <p className="text-lg text-zinc-400">夜の街のための統合プラットフォーム</p>
      </header>

      <section className="mb-12 grid gap-4 sm:grid-cols-2">
        {PRODUCTS.map((p) => (
          <Link
            key={p.id}
            href={p.url}
            target={p.url.startsWith('http') ? '_blank' : undefined}
            className={`group relative overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br ${p.accent} p-6 transition hover:border-zinc-600`}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xl font-bold">{p.name}</span>
              <span className="text-xs text-zinc-500">{p.nameJa}</span>
              {p.soon && (
                <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                  soon
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-300">{p.desc}</p>
          </Link>
        ))}
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8 text-center">
        <h2 className="mb-2 text-2xl font-bold">NOXA アカウント</h2>
        <p className="mb-6 text-sm text-zinc-400">
          1 つのアカウントで NOXA のすべてのサービスを利用できます。<br />
          AI クレジット・プラン・通知設定はここで統合管理。
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/account/login"
            className="rounded-lg bg-white px-6 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200"
          >
            ログイン
          </Link>
          <Link
            href="/account/signup"
            className="rounded-lg border border-zinc-700 bg-transparent px-6 py-2.5 text-sm font-medium transition hover:border-zinc-500"
          >
            アカウント作成
          </Link>
        </div>
      </section>

      <footer className="mt-16 text-center text-xs text-zinc-600">
        © 2026 NOXA — 株式会社 EGS
      </footer>
    </main>
  );
}
