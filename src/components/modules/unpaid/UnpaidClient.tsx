'use client';

import Link from 'next/link';

/**
 * 売掛管理モジュール（ガワ・モックのみ）
 *
 * 実データ連携は未実装。モックデータで画面構成を確認する目的。
 * 実装時は Firestore personal_customers/{uid}/unpaid 等から取得する想定。
 */

const mono = 'var(--noxa-font-mono)';

type UnpaidStatus = '未回収' | '一部回収' | '回収済';

type UnpaidRecord = {
  id: string;
  customerName: string;
  castName: string;
  amount: number;
  occurredAt: string; // YYYY-MM-DD
  elapsedDays: number;
  status: UnpaidStatus;
};

/** モックデータ（8〜10件・金額・経過日数バラバラ） */
const MOCK_RECORDS: UnpaidRecord[] = [
  { id: 'u01', customerName: '田中 誠一', castName: 'あいり', amount: 128000, occurredAt: '2026-02-28', elapsedDays: 93, status: '未回収' },
  { id: 'u02', customerName: '鈴木 浩二', castName: 'ゆき', amount: 55000, occurredAt: '2026-04-05', elapsedDays: 57, status: '未回収' },
  { id: 'u03', customerName: '山本 健太', castName: 'れいな', amount: 32000, occurredAt: '2026-04-22', elapsedDays: 40, status: '一部回収' },
  { id: 'u04', customerName: '伊藤 龍之介', castName: 'みく', amount: 84000, occurredAt: '2026-03-10', elapsedDays: 83, status: '未回収' },
  { id: 'u05', customerName: '渡辺 翔', castName: 'あいり', amount: 18000, occurredAt: '2026-05-14', elapsedDays: 18, status: '一部回収' },
  { id: 'u06', customerName: '中村 光', castName: 'さや', amount: 64000, occurredAt: '2026-04-01', elapsedDays: 61, status: '未回収' },
  { id: 'u07', customerName: '小林 純平', castName: 'ゆき', amount: 22000, occurredAt: '2026-05-20', elapsedDays: 12, status: '未回収' },
  { id: 'u08', customerName: '加藤 大輔', castName: 'れいな', amount: 97500, occurredAt: '2026-03-28', elapsedDays: 65, status: '未回収' },
  { id: 'u09', customerName: '佐藤 雄一', castName: 'さや', amount: 41000, occurredAt: '2026-04-30', elapsedDays: 32, status: '一部回収' },
  { id: 'u10', customerName: '松本 隆', castName: 'みく', amount: 15000, occurredAt: '2026-01-15', elapsedDays: 136, status: '回収済' },
];

/** 経過日数に応じたステータス色を返す */
function elapsedColor(days: number): string {
  if (days >= 60) return 'var(--noxa-status-error)';
  if (days >= 30) return 'var(--noxa-status-warning)';
  return 'var(--noxa-text-primary)';
}

/** 回収ステータスバッジのスタイル */
function statusStyle(status: UnpaidStatus): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 9px',
    borderRadius: 9999,
    fontFamily: mono,
    fontSize: 10,
    letterSpacing: '0.08em',
    whiteSpace: 'nowrap',
  };
  switch (status) {
    case '未回収':
      return { ...base, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: 'var(--noxa-status-error)' };
    case '一部回収':
      return { ...base, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)', color: 'var(--noxa-status-warning)' };
    case '回収済':
      return { ...base, background: 'rgba(123,232,161,0.10)', border: '1px solid rgba(123,232,161,0.30)', color: 'var(--noxa-status-success)' };
  }
}

const yen = (n: number) =>
  `¥${Math.round(n).toLocaleString('ja-JP')}`;

/** 顧客別残高を集計（回収済は除外） */
function buildBalanceRanking(records: UnpaidRecord[]) {
  const map = new Map<string, number>();
  for (const r of records) {
    if (r.status === '回収済') continue;
    map.set(r.customerName, (map.get(r.customerName) ?? 0) + r.amount);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
}

export function UnpaidClient() {
  const records = MOCK_RECORDS;

  // サマリ集計（回収済除外）
  const active = records.filter((r) => r.status !== '回収済');
  const totalAmount = active.reduce((s, r) => s + r.amount, 0);
  const totalCount = active.length;
  const maxElapsed = active.length > 0 ? Math.max(...active.map((r) => r.elapsedDays)) : 0;

  const balanceRanking = buildBalanceRanking(records);
  const maxBalance = balanceRanking.length > 0 ? balanceRanking[0][1] : 1;

  return (
    <div
      style={{
        color: 'var(--noxa-text-primary)',
        fontFamily: 'var(--noxa-font-sans-jp)',
        borderRadius: 16,
        border: '1px solid var(--noxa-border)',
        padding: 'clamp(16px, 3vw, 28px)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 装飾グロー */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-30%',
          right: '-10%',
          width: 700,
          height: 420,
          background: 'radial-gradient(ellipse, rgba(251,191,36,0.07) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>
        {/* breadcrumb */}
        <nav aria-label="breadcrumb" style={{ marginBottom: 10 }}>
          <ol
            style={{
              display: 'flex',
              gap: 8,
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--noxa-text-faint)',
              listStyle: 'none',
              margin: 0,
              padding: 0,
            }}
          >
            <li>
              <Link href="/account" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>
                Noxa OS
              </Link>
            </li>
            <li aria-hidden>·</li>
            <li>unpaid</li>
          </ol>
        </nav>

        {/* eyebrow + 見出し */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 20,
          }}
        >
          <div>
            <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>
              Noxa OS · Module · Unpaid
            </div>
            <h1
              className="noxa-display"
              style={{
                fontSize: 'clamp(26px, 4vw, 38px)',
                margin: 0,
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--noxa-font-display-en)',
                  fontStyle: 'italic',
                  color: 'var(--noxa-status-warning)',
                  fontWeight: 400,
                }}
              >
                №
              </span>
              <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>
                売掛管理
              </span>
            </h1>
          </div>

          {/* モックバッジ */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              background: 'rgba(251,191,36,0.08)',
              border: '1px solid rgba(251,191,36,0.25)',
              borderRadius: 9999,
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: '0.12em',
              color: 'var(--noxa-status-warning)',
              textTransform: 'uppercase',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: 'var(--noxa-status-warning)',
                boxShadow: '0 0 6px var(--noxa-status-warning)',
              }}
            />
            モック
          </div>
        </div>

        {/* ── サマリカード ── */}
        <div
          className="grid grid-cols-1"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}
        >
          <SummaryCard label="未収金合計" value={yen(totalAmount)} accent="primary" />
          <SummaryCard label="件数（未回収＋一部）" value={`${totalCount} 件`} />
          <SummaryCard
            label="最長滞留日数"
            value={`${maxElapsed} 日`}
            accent="warning"
          />
        </div>

        {/* ── 売掛一覧テーブル ── */}
        <section
          aria-label="売掛一覧"
          style={{
            background: 'var(--noxa-surface-card)',
            border: '1px solid var(--noxa-border)',
            borderRadius: 16,
            padding: 18,
            marginBottom: 20,
          }}
        >
          <h2
            className="noxa-eyebrow"
            style={{ fontSize: 11, marginBottom: 14, margin: '0 0 14px' }}
          >
            売掛一覧
          </h2>

          {/* 375px以下は横スクロール */}
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table
              style={{
                width: '100%',
                minWidth: 640,
                borderCollapse: 'collapse',
                fontFamily: mono,
                fontSize: 12,
              }}
              aria-label="売掛記録テーブル"
            >
              <thead>
                <tr>
                  {['客名', '指名キャスト', '金額', '発生日', '経過日数', 'ステータス', ''].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      style={{
                        textAlign: h === '金額' || h === '経過日数' ? 'right' : 'left',
                        padding: '6px 10px',
                        borderBottom: '1px solid var(--noxa-border)',
                        fontSize: 10,
                        letterSpacing: '0.08em',
                        color: 'var(--noxa-text-faint)',
                        whiteSpace: 'nowrap',
                        fontWeight: 500,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: '1px solid var(--noxa-divider)',
                    }}
                  >
                    {/* 客名 */}
                    <td
                      style={{
                        padding: '10px 10px',
                        fontSize: 13,
                        fontFamily: 'var(--noxa-font-sans-jp)',
                        whiteSpace: 'nowrap',
                        color: 'var(--noxa-text-primary)',
                      }}
                    >
                      {r.customerName}
                    </td>

                    {/* 指名キャスト */}
                    <td
                      style={{
                        padding: '10px 10px',
                        fontSize: 12,
                        color: 'var(--noxa-text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.castName}
                    </td>

                    {/* 金額 */}
                    <td
                      style={{
                        padding: '10px 10px',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: 13,
                        color: 'var(--noxa-text-primary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {yen(r.amount)}
                    </td>

                    {/* 発生日 */}
                    <td
                      style={{
                        padding: '10px 10px',
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--noxa-text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.occurredAt}
                    </td>

                    {/* 経過日数 */}
                    <td
                      style={{
                        padding: '10px 10px',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        color: elapsedColor(r.elapsedDays),
                        fontWeight: r.elapsedDays >= 30 ? 600 : 400,
                        whiteSpace: 'nowrap',
                      }}
                      aria-label={`${r.elapsedDays}日経過${r.elapsedDays >= 60 ? '（要対応）' : r.elapsedDays >= 30 ? '（注意）' : ''}`}
                    >
                      {r.elapsedDays} 日
                    </td>

                    {/* ステータス */}
                    <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                      <span style={statusStyle(r.status)}>{r.status}</span>
                    </td>

                    {/* 回収記録ボタン */}
                    <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                      {r.status !== '回収済' && (
                        <button
                          type="button"
                          disabled
                          aria-label={`${r.customerName}の回収記録（未実装）`}
                          style={{
                            padding: '4px 12px',
                            borderRadius: 8,
                            border: '1px solid var(--noxa-border)',
                            background: 'transparent',
                            color: 'var(--noxa-text-muted)',
                            fontFamily: mono,
                            fontSize: 10,
                            letterSpacing: '0.06em',
                            cursor: 'not-allowed',
                            opacity: 0.6,
                          }}
                        >
                          回収記録
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 顧客別残高 上位 ── */}
        <section
          aria-label="顧客別未収残高"
          style={{
            background: 'var(--noxa-surface-card)',
            border: '1px solid var(--noxa-border)',
            borderRadius: 16,
            padding: 18,
            marginBottom: 20,
          }}
        >
          <h2
            className="noxa-eyebrow"
            style={{ fontSize: 11, margin: '0 0 14px' }}
          >
            顧客別残高（上位）
          </h2>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {balanceRanking.map(([name, balance], i) => (
              <li key={name} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                  }}
                >
                  <span style={{ fontSize: 13, fontFamily: 'var(--noxa-font-sans-jp)' }}>
                    <span
                      style={{
                        fontFamily: mono,
                        color: 'var(--noxa-text-faint)',
                        marginRight: 8,
                        fontSize: 11,
                      }}
                    >
                      {i + 1}
                    </span>
                    {name}
                  </span>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 13,
                      fontVariantNumeric: 'tabular-nums',
                      color:
                        balance >= 80000
                          ? 'var(--noxa-status-error)'
                          : balance >= 40000
                          ? 'var(--noxa-status-warning)'
                          : 'var(--noxa-text-primary)',
                    }}
                  >
                    {yen(balance)}
                  </span>
                </div>
                {/* バー */}
                <div
                  style={{
                    height: 4,
                    background: 'var(--noxa-surface-muted)',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${(balance / maxBalance) * 100}%`,
                      height: '100%',
                      background:
                        'linear-gradient(90deg, var(--noxa-status-warning), var(--noxa-status-error))',
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* 凡例 */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 12,
            fontSize: 11,
            fontFamily: mono,
            color: 'var(--noxa-text-faint)',
          }}
          aria-label="経過日数の凡例"
        >
          <span>
            <span style={{ color: 'var(--noxa-text-primary)' }}>●</span> 30 日未満
          </span>
          <span>
            <span style={{ color: 'var(--noxa-status-warning)' }}>●</span> 30〜59 日
          </span>
          <span>
            <span style={{ color: 'var(--noxa-status-error)' }}>●</span> 60 日以上
          </span>
        </div>

        <p
          style={{
            margin: '8px 0 0',
            fontSize: 11,
            lineHeight: 1.6,
            color: 'var(--noxa-text-faint)',
            fontFamily: mono,
          }}
        >
          ※ モックデータ表示中。実データ連携は未実装。
        </p>
      </div>
    </div>
  );
}

/** サマリKPIカード */
function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'primary' | 'warning';
}) {
  const valueColor =
    accent === 'primary'
      ? 'var(--noxa-accent-primary-ink)'
      : accent === 'warning'
      ? 'var(--noxa-status-warning)'
      : 'var(--noxa-text-primary)';

  return (
    <div
      style={{
        background: 'var(--noxa-surface-card)',
        border: '1px solid var(--noxa-border)',
        borderRadius: 14,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span
        style={{
          fontFamily: mono,
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--noxa-text-faint)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--noxa-font-display-en)',
          fontSize: 26,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color: valueColor,
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default UnpaidClient;
