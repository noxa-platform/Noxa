'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * ⑨ 名刺発注 — オリシャン名刺デザイン・印刷発注 UI モック（ガワのみ）
 *
 * 印刷パートナー連携・実発注ロジックなし。テンプレ選択 → エディタプレビュー → 注文フォームの
 * 見た目だけ。ロジック・永続化なし。すべて MOCK_* のモックデータ。
 * UI 内部 state（テンプレ選択・入力値・部数・用紙・加工）のみ useState で実装。
 */

// ─────────────────────────────────────────────
// モックデータ
// ─────────────────────────────────────────────

type PaperType = 'matte' | 'gloss' | 'foil';
type Quantity = 100 | 300 | 500;

type MockTemplate = {
  id: string;
  label: string;
  accent: string;       // メインカラー（CSS値）
  bg: string;           // カード背景（CSS値）
  textColor: string;    // 名前テキスト色
  style: string;        // スタイルキャッチ
};

const MOCK_TEMPLATES: MockTemplate[] = [
  {
    id: 'violet',
    label: 'Violet Night',
    accent: '#8B5CF6',
    bg: 'linear-gradient(135deg, #1A1228 0%, #2D1B69 100%)',
    textColor: '#C084FC',
    style: 'purple / violet · エレガント',
  },
  {
    id: 'wine',
    label: 'Deep Wine',
    accent: '#C4384A',
    bg: 'linear-gradient(135deg, #1A0D0F 0%, #5C1A24 100%)',
    textColor: '#F2A8B3',
    style: 'wine / crimson · 情熱',
  },
  {
    id: 'gold',
    label: 'Gold Luxe',
    accent: '#D4B27A',
    bg: 'linear-gradient(135deg, #131007 0%, #3B2E10 100%)',
    textColor: '#F0D9A8',
    style: 'gold / ivory · 高級感',
  },
  {
    id: 'noir',
    label: 'Blanc Noir',
    accent: '#A1A1AA',
    bg: 'linear-gradient(135deg, #09090B 0%, #1C1C1E 100%)',
    textColor: '#F4F4F5',
    style: 'monochrome · クール',
  },
];

const QUANTITY_OPTIONS: { value: Quantity; label: string }[] = [
  { value: 100, label: '100 枚' },
  { value: 300, label: '300 枚' },
  { value: 500, label: '500 枚' },
];

const PAPER_OPTIONS: { value: PaperType; label: string; note: string }[] = [
  { value: 'matte', label: 'マット', note: '落ち着いた質感' },
  { value: 'gloss', label: '光沢', note: '鮮やかな発色' },
  { value: 'foil', label: '箔押し', note: '高級感 +¥2,000' },
];

// 部数 × 基本単価（¥/枚）テーブル
const PRICE_TABLE: Record<Quantity, number> = {
  100: 18,   // 100枚 × ¥18 = ¥1,800
  300: 16,   // 300枚 × ¥16 = ¥4,800
  500: 14,   // 500枚 × ¥14 = ¥7,000
};
const SHIPPING_FEE = 880;       // 送料（全国一律モック）
const FOIL_SURCHARGE = 2000;    // 箔押し加算

// ─────────────────────────────────────────────
// ヘルパー
// ─────────────────────────────────────────────

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
const mono = 'var(--noxa-font-mono)';

// ─────────────────────────────────────────────
// コンポーネント
// ─────────────────────────────────────────────

export function BusinessCardClient() {
  // テンプレ選択
  const [selectedTemplate, setSelectedTemplate] = useState<string>('violet');

  // エディタ入力値（見た目のみ）
  const [genjName, setGenjName] = useState('凛');
  const [shopName, setShopName] = useState('Club Noxa');
  const [sns, setSns] = useState('@rin_clubnoxa');
  const [catchcopy, setCatchcopy] = useState('あなたの夜を、もっと特別に。');

  // 注文オプション
  const [quantity, setQuantity] = useState<Quantity>(300);
  const [paper, setPaper] = useState<PaperType>('matte');

  const template = MOCK_TEMPLATES.find((t) => t.id === selectedTemplate) ?? MOCK_TEMPLATES[0];

  // 金額計算
  const subtotal = quantity * PRICE_TABLE[quantity] + (paper === 'foil' ? FOIL_SURCHARGE : 0);
  const total = subtotal + SHIPPING_FEE;

  return (
    <div
      style={{
        borderRadius: 16,
        border: '1px solid var(--noxa-border)',
        padding: 'clamp(16px, 3vw, 28px)',
        position: 'relative',
        overflow: 'hidden',
        color: 'var(--noxa-text-primary)',
        fontFamily: 'var(--noxa-font-sans-jp)',
      }}
    >
      {/* ambient glow — violetトーン */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-20%',
          right: '-10%',
          width: 640,
          height: 380,
          background: 'radial-gradient(ellipse, rgba(192, 132, 252, 0.10) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: '-15%',
          left: '-8%',
          width: 400,
          height: 280,
          background: 'radial-gradient(ellipse, rgba(196, 56, 74, 0.07) 0%, transparent 60%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>
        {/* ─ header ─ */}
        <header style={{ marginBottom: 24 }}>
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
                <Link href="/" style={{ color: 'var(--noxa-text-muted)', textDecoration: 'none' }}>
                  Noxa OS
                </Link>
              </li>
              <li aria-hidden>·</li>
              <li>business-card</li>
            </ol>
          </nav>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div className="noxa-eyebrow" style={{ marginBottom: 6 }}>
                Noxa OS · Module 09 · Business Card
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
                    color: 'var(--noxa-accent-primary-ink)',
                    fontWeight: 400,
                  }}
                >
                  № 09
                </span>
                <span style={{ fontFamily: 'var(--noxa-font-display-jp)', fontWeight: 500 }}>
                  名刺発注
                </span>
              </h1>
            </div>

            {/* 印刷ロジックなしを明示するバッジ */}
            <div
              role="note"
              aria-label="このモジュールは印刷発注ロジックを持ちません（UI モック）"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                background: 'rgba(184, 156, 251, 0.10)',
                border: '1px solid var(--noxa-divider)',
                borderRadius: 9999,
                fontFamily: mono,
                fontSize: 10,
                letterSpacing: '0.12em',
                color: 'var(--noxa-text-muted)',
                textTransform: 'uppercase',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: 'var(--noxa-accent-primary-ink)',
                }}
              />
              UI モック · 発注ロジックなし
            </div>
          </div>
        </header>

        {/* ─ Section 1: テンプレート選択 ─ */}
        <section aria-label="テンプレート選択" style={{ marginBottom: 28 }}>
          <PaneTitle>テンプレート選択</PaneTitle>
          <div
            className="grid grid-cols-2 sm:grid-cols-4"
            style={{ gap: 'clamp(10px, 1.4vw, 16px)' }}
          >
            {MOCK_TEMPLATES.map((tpl) => {
              const active = tpl.id === selectedTemplate;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => setSelectedTemplate(tpl.id)}
                  aria-pressed={active}
                  aria-label={`テンプレート ${tpl.label} を選択`}
                  style={{
                    appearance: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    background: 'none',
                    border: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    alignItems: 'stretch',
                    outline: 'none',
                  }}
                >
                  {/* 名刺プレビューカード */}
                  <div
                    style={{
                      aspectRatio: '91 / 55',
                      borderRadius: 10,
                      background: tpl.bg,
                      border: active
                        ? `2px solid ${tpl.accent}`
                        : '2px solid var(--noxa-border)',
                      boxShadow: active
                        ? `0 0 0 3px ${tpl.accent}55, 0 8px 32px ${tpl.accent}33`
                        : 'none',
                      transition: 'box-shadow 200ms var(--noxa-ease-natural), border-color 200ms var(--noxa-ease-natural)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'flex-start',
                      padding: '10px 14px',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    {/* デコライン */}
                    <div
                      aria-hidden
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: 3,
                        background: tpl.accent,
                        opacity: 0.85,
                      }}
                    />
                    <span
                      style={{
                        fontFamily: 'var(--noxa-font-display-en)',
                        fontStyle: 'italic',
                        fontSize: 'clamp(13px, 2vw, 18px)',
                        fontWeight: 600,
                        color: tpl.textColor,
                        lineHeight: 1.1,
                        letterSpacing: '0.04em',
                      }}
                    >
                      凛
                    </span>
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 9,
                        color: tpl.accent,
                        letterSpacing: '0.12em',
                        marginTop: 3,
                        opacity: 0.9,
                      }}
                    >
                      Club Noxa
                    </span>
                  </div>
                  {/* ラベル */}
                  <div style={{ textAlign: 'left' }}>
                    <div
                      style={{
                        fontFamily: 'var(--noxa-font-display-en)',
                        fontSize: 12,
                        fontWeight: 600,
                        color: active ? tpl.accent : 'var(--noxa-text-primary)',
                        transition: 'color 200ms',
                      }}
                    >
                      {tpl.label}
                    </div>
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        color: 'var(--noxa-text-faint)',
                        marginTop: 2,
                      }}
                    >
                      {tpl.style}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ─ Section 2+3: エディタ + 注文フォーム ─ */}
        <div
          className="grid grid-cols-1 lg:grid-cols-[1fr_320px]"
          style={{ gap: 'clamp(14px, 2vw, 22px)', alignItems: 'start' }}
        >
          {/* ─ Section 2: エディタ + プレビュー ─ */}
          <section aria-label="デザインエディタ">
            <PaneTitle>デザインエディタ · プレビュー</PaneTitle>

            <div
              style={{
                background: 'var(--noxa-surface-card)',
                border: '1px solid var(--noxa-border)',
                borderRadius: 16,
                padding: 'clamp(16px, 2vw, 24px)',
                display: 'flex',
                flexDirection: 'column',
                gap: 24,
              }}
            >
              {/* 名刺プレビュー（実寸風） */}
              <div>
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    color: 'var(--noxa-text-faint)',
                    textTransform: 'uppercase',
                    marginBottom: 10,
                  }}
                >
                  プレビュー — 91 × 55 mm
                </div>
                <div
                  style={{
                    maxWidth: 360,
                    aspectRatio: '91 / 55',
                    borderRadius: 12,
                    background: template.bg,
                    border: `1px solid ${template.accent}66`,
                    boxShadow: `0 8px 40px ${template.accent}22, 0 2px 8px rgba(0,0,0,0.6)`,
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    alignItems: 'stretch',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  {/* アクセントライン（左） */}
                  <div
                    aria-hidden
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: 3,
                      height: '100%',
                      background: template.accent,
                    }}
                  />
                  {/* テキストエリア */}
                  <div
                    style={{
                      padding: 'clamp(10px, 2vw, 16px) clamp(12px, 2.4vw, 20px)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                  >
                    {/* 源氏名 */}
                    <div
                      style={{
                        fontFamily: 'var(--noxa-font-display-en)',
                        fontStyle: 'italic',
                        fontSize: 'clamp(20px, 4vw, 30px)',
                        fontWeight: 600,
                        color: template.textColor,
                        lineHeight: 1.05,
                        letterSpacing: '0.03em',
                      }}
                    >
                      {genjName || '（源氏名）'}
                    </div>
                    {/* 店名 */}
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 'clamp(8px, 1.2vw, 10px)',
                        color: template.accent,
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {shopName || '（店名）'}
                    </div>
                    {/* SNS */}
                    {sns && (
                      <div
                        style={{
                          fontFamily: mono,
                          fontSize: 'clamp(7px, 1vw, 9px)',
                          color: template.textColor,
                          opacity: 0.7,
                          marginTop: 2,
                        }}
                      >
                        {sns}
                      </div>
                    )}
                    {/* キャッチコピー */}
                    {catchcopy && (
                      <div
                        style={{
                          fontFamily: 'var(--noxa-font-display-jp)',
                          fontSize: 'clamp(7px, 1vw, 9px)',
                          color: template.textColor,
                          opacity: 0.65,
                          marginTop: 4,
                          lineHeight: 1.5,
                        }}
                      >
                        {catchcopy}
                      </div>
                    )}
                  </div>
                  {/* 写真プレースホルダ */}
                  <div
                    aria-label="写真プレースホルダ"
                    style={{
                      width: 'clamp(56px, 10vw, 80px)',
                      margin: 'clamp(8px, 1.5vw, 12px)',
                      background: 'rgba(255,255,255,0.07)',
                      border: `1px dashed ${template.accent}66`,
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div
                      aria-hidden
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        background: `${template.accent}44`,
                        border: `1px solid ${template.accent}66`,
                      }}
                    />
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 7,
                        color: template.textColor,
                        opacity: 0.45,
                        textAlign: 'center',
                        lineHeight: 1.4,
                      }}
                    >
                      PHOTO
                    </div>
                  </div>
                </div>
              </div>

              {/* 入力欄 */}
              <div
                className="grid grid-cols-1 sm:grid-cols-2"
                style={{ gap: 14 }}
              >
                <InputField
                  id="bc-genji-name"
                  label="源氏名"
                  value={genjName}
                  onChange={setGenjName}
                  placeholder="凛"
                  accentColor={template.accent}
                />
                <InputField
                  id="bc-shop-name"
                  label="所属店"
                  value={shopName}
                  onChange={setShopName}
                  placeholder="Club Noxa"
                  accentColor={template.accent}
                />
                <InputField
                  id="bc-sns"
                  label="SNS / 連絡先"
                  value={sns}
                  onChange={setSns}
                  placeholder="@rin_clubnoxa"
                  accentColor={template.accent}
                />
                <InputField
                  id="bc-catchcopy"
                  label="キャッチコピー"
                  value={catchcopy}
                  onChange={setCatchcopy}
                  placeholder="あなたの夜を、もっと特別に。"
                  accentColor={template.accent}
                />
              </div>
            </div>
          </section>

          {/* ─ Section 3: 注文フォーム ─ */}
          <section aria-label="注文オプション">
            <PaneTitle>注文オプション</PaneTitle>

            <div
              style={{
                background: 'var(--noxa-surface-card)',
                border: '1px solid var(--noxa-border)',
                borderRadius: 16,
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 20,
              }}
            >
              {/* 部数 */}
              <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                <legend
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--noxa-text-muted)',
                    marginBottom: 10,
                    display: 'block',
                  }}
                >
                  部数
                </legend>
                <div style={{ display: 'flex', gap: 8 }}>
                  {QUANTITY_OPTIONS.map((opt) => {
                    const active = quantity === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setQuantity(opt.value)}
                        aria-pressed={active}
                        style={{
                          appearance: 'none',
                          cursor: 'pointer',
                          flex: 1,
                          minHeight: 44,
                          borderRadius: 10,
                          fontFamily: mono,
                          fontSize: 13,
                          fontWeight: active ? 700 : 400,
                          background: active ? 'rgba(139, 92, 246, 0.18)' : 'var(--noxa-surface-muted)',
                          border: active
                            ? '1px solid var(--noxa-accent-primary)'
                            : '1px solid var(--noxa-border)',
                          color: active ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-muted)',
                          boxShadow: active ? 'var(--noxa-glow-ring)' : 'none',
                          transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {/* 用紙 / 加工 */}
              <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                <legend
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--noxa-text-muted)',
                    marginBottom: 10,
                    display: 'block',
                  }}
                >
                  用紙 / 加工
                </legend>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {PAPER_OPTIONS.map((opt) => {
                    const active = paper === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setPaper(opt.value)}
                        aria-pressed={active}
                        style={{
                          appearance: 'none',
                          cursor: 'pointer',
                          minHeight: 44,
                          borderRadius: 10,
                          padding: '10px 14px',
                          background: active ? 'rgba(139, 92, 246, 0.12)' : 'var(--noxa-surface-muted)',
                          border: active
                            ? '1px solid var(--noxa-accent-primary)'
                            : '1px solid var(--noxa-border)',
                          color: 'var(--noxa-text-primary)',
                          textAlign: 'left',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                        }}
                      >
                        <div>
                          <span
                            style={{
                              fontFamily: 'var(--noxa-font-sans-jp)',
                              fontSize: 13,
                              fontWeight: active ? 600 : 400,
                              color: active ? 'var(--noxa-accent-primary-ink)' : 'var(--noxa-text-primary)',
                            }}
                          >
                            {opt.label}
                          </span>
                          <span
                            style={{
                              display: 'block',
                              fontFamily: mono,
                              fontSize: 10,
                              color: 'var(--noxa-text-faint)',
                              marginTop: 2,
                            }}
                          >
                            {opt.note}
                          </span>
                        </div>
                        {active && (
                          <div
                            aria-hidden
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              background: 'var(--noxa-accent-primary)',
                              boxShadow: 'var(--noxa-glow-soft)',
                              flex: 'none',
                            }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {/* 区切り */}
              <div style={{ height: 1, background: 'var(--noxa-divider)' }} />

              {/* 注文サマリ */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--noxa-text-muted)',
                    marginBottom: 4,
                  }}
                >
                  注文サマリ
                </div>
                <SummaryRow label={`印刷代（${quantity}枚）`} value={yen(quantity * PRICE_TABLE[quantity])} />
                {paper === 'foil' && (
                  <SummaryRow label="箔押し加算" value={yen(FOIL_SURCHARGE)} />
                )}
                <SummaryRow label="送料" value={yen(SHIPPING_FEE)} />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    marginTop: 6,
                    paddingTop: 10,
                    borderTop: '1px solid var(--noxa-border-strong)',
                  }}
                >
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 11,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: 'var(--noxa-text-muted)',
                    }}
                  >
                    合計
                  </span>
                  <span
                    className="noxa-display"
                    style={{
                      fontFamily: 'var(--noxa-font-display-en)',
                      fontSize: 28,
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--noxa-text-primary)',
                    }}
                  >
                    {yen(total)}
                  </span>
                </div>
              </div>

              {/* アクション */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* 注文するボタン（primary） */}
                <button
                  type="button"
                  onClick={() => { /* no-op: ガワのみ */ }}
                  style={{
                    appearance: 'none',
                    cursor: 'pointer',
                    width: '100%',
                    minHeight: 48,
                    borderRadius: 12,
                    border: '1px solid var(--noxa-accent-primary)',
                    background: 'var(--noxa-accent-primary)',
                    color: '#fff',
                    fontFamily: 'var(--noxa-font-sans-jp)',
                    fontSize: 15,
                    fontWeight: 600,
                    boxShadow: 'var(--noxa-glow-soft)',
                    transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                  }}
                >
                  注文する
                </button>
                {/* 前回デザインで再注文ボタン（secondary） */}
                <button
                  type="button"
                  onClick={() => { /* no-op: ガワのみ */ }}
                  style={{
                    appearance: 'none',
                    cursor: 'pointer',
                    width: '100%',
                    minHeight: 48,
                    borderRadius: 12,
                    border: '1px solid var(--noxa-border-strong)',
                    background: 'var(--noxa-surface-muted)',
                    color: 'var(--noxa-text-primary)',
                    fontFamily: 'var(--noxa-font-sans-jp)',
                    fontSize: 14,
                    fontWeight: 500,
                    transition: 'all var(--noxa-duration-fast) var(--noxa-ease-natural)',
                  }}
                >
                  前回デザインで再注文
                </button>
              </div>

              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: 'var(--noxa-text-faint)',
                  fontFamily: mono,
                }}
              >
                ※ 印刷パートナー・実発注は未実装。
                <br />
                ボタンは現在 no-op（UI モック段階）。
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 共通小コンポーネント
// ─────────────────────────────────────────────

function PaneTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="noxa-eyebrow"
      style={{ fontSize: 11, marginBottom: 12, display: 'block' }}
    >
      {children}
    </h2>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 12, color: 'var(--noxa-text-muted)' }}>{label}</span>
      <span
        style={{
          fontFamily: mono,
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--noxa-text-primary)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function InputField({
  id,
  label,
  value,
  onChange,
  placeholder,
  accentColor,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  accentColor: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label
        htmlFor={id}
        style={{
          fontFamily: mono,
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--noxa-text-muted)',
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        style={{
          appearance: 'none',
          width: '100%',
          minHeight: 44,
          padding: '10px 14px',
          borderRadius: 10,
          background: 'var(--noxa-surface-muted)',
          border: focused
            ? `1px solid ${accentColor}`
            : '1px solid var(--noxa-border)',
          boxShadow: focused
            ? `0 0 0 3px ${accentColor}33`
            : 'none',
          color: 'var(--noxa-text-primary)',
          fontFamily: 'var(--noxa-font-sans-jp)',
          fontSize: 16, // iOS ズーム防止
          outline: 'none',
          transition: 'border-color var(--noxa-duration-fast) var(--noxa-ease-natural), box-shadow var(--noxa-duration-fast) var(--noxa-ease-natural)',
          caretColor: accentColor,
        }}
      />
    </div>
  );
}

export default BusinessCardClient;
