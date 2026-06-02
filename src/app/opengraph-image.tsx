import { ImageResponse } from 'next/og';

/**
 * Noxa — 動的 OG 画像
 * Next.js convention: app/opengraph-image.tsx で /opengraph-image にホスト
 * SNS シェア時に Noxa brand の dark + violet で表示。
 */

export const runtime = 'edge';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Noxa — Nightfall, refined.';

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#07050D',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 80,
          position: 'relative',
          color: '#F5F1FA',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* ambient glows */}
        <div
          style={{
            position: 'absolute',
            top: -200,
            right: -200,
            width: 700,
            height: 700,
            background: 'radial-gradient(circle, rgba(139,92,246,0.32) 0%, transparent 60%)',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -150,
            left: -150,
            width: 500,
            height: 500,
            background: 'radial-gradient(circle, rgba(192,132,252,0.22) 0%, transparent 60%)',
            display: 'flex',
          }}
        />

        {/* top eyebrow + brand icon */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 22,
            fontSize: 18,
            color: '#B89CFB',
            letterSpacing: 6,
            textTransform: 'uppercase',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://noxa.egshugy.com/icon-192.png" width={96} height={96} alt="" style={{ borderRadius: 22 }} />
          <span>夜の街のための統合 OS</span>
          <span style={{ flex: 1, height: 1, background: 'rgba(184,156,251,0.32)' }} />
        </div>

        {/* center wordmark */}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: 220,
              fontWeight: 500,
              letterSpacing: -6,
              lineHeight: 1,
            }}
          >
            <span>N</span>
            <span style={{ color: '#B89CFB' }}>O</span>
            <span>XA</span>
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 42,
              color: '#F5F1FA',
              marginTop: 24,
              letterSpacing: 2,
            }}
          >
            夜の街のための、<span style={{ color: '#B89CFB', marginLeft: 4 }}>統合プラットフォーム</span>
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 24,
              fontStyle: 'italic',
              color: '#A89FBE',
              marginTop: 14,
            }}
          >
            Nightfall, refined.
          </div>
        </div>

        {/* bottom row: products */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            fontSize: 18,
            color: '#A89FBE',
          }}
        >
          <div style={{ display: 'flex', gap: 36 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 5, background: '#8B5CF6', display: 'flex' }} />
              yorulog
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 5, background: '#B89CFB', display: 'flex' }} />
              nomishugy
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 5, background: '#C4384A', display: 'flex' }} />
              community
            </span>
          </div>
          <div style={{ display: 'flex', color: '#6E6585', letterSpacing: 4 }}>NOXA.EGSHUGY.COM</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
