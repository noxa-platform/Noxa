import { ImageResponse } from 'next/og';

/**
 * Noxa — favicon / アプリアイコン
 * Next.js convention: app/icon.tsx で /icon を 512×512 で配信
 */

export const runtime = 'edge';
export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#07050D',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -100,
            right: -100,
            width: 400,
            height: 400,
            background: 'radial-gradient(circle, rgba(139,92,246,0.45) 0%, transparent 60%)',
            display: 'flex',
          }}
        />
        <div
          style={{
            display: 'flex',
            fontSize: 320,
            fontWeight: 500,
            color: '#B89CFB',
            letterSpacing: -10,
            lineHeight: 1,
            position: 'relative',
          }}
        >
          N
        </div>
      </div>
    ),
    { ...size }
  );
}
