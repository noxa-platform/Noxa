import { ImageResponse } from 'next/og';

/**
 * 公開プロフィール用の動的 OG 画像ビルダー。
 * Firestore REST（profile_pages は public read）で handle を引き、NOXA ブランドで描画。
 */
export const OG_SIZE = { width: 1200, height: 630 };

type Parsed = { displayName: string; handle: string; avatar: string; type: string; published: boolean } | null;

async function fetchProfile(handle: string): Promise<Parsed> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/noxa-platform/databases/(default)/documents/profile_pages/${encodeURIComponent(handle.toLowerCase())}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as { fields?: Record<string, { stringValue?: string; booleanValue?: boolean }> };
    const f = json.fields ?? {};
    return {
      displayName: f.displayName?.stringValue ?? handle,
      handle: f.handle?.stringValue ?? handle,
      avatar: f.avatar?.stringValue ?? '',
      type: f.type?.stringValue ?? 'user',
      published: f.published?.booleanValue ?? false,
    };
  } catch { return null; }
}

export async function buildProfileOg(handle: string, expectType: 'user' | 'shop'): Promise<ImageResponse> {
  const p = await fetchProfile(handle);
  const ok = p && p.published && p.type === expectType;
  const name = ok ? p!.displayName : 'Noxa';
  const sub = ok ? `@${p!.handle}` : 'Nightfall, refined.';
  const avatar = ok ? p!.avatar : '';
  const initial = (name || '?').trim().charAt(0).toUpperCase();

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', background: '#07050D', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#F5F1FA', fontFamily: 'system-ui, sans-serif', position: 'relative' }}>
        <div style={{ position: 'absolute', top: -180, left: 420, width: 700, height: 540, background: 'radial-gradient(circle, rgba(139,92,246,0.34) 0%, transparent 60%)', display: 'flex' }} />
        <div style={{ display: 'flex', width: 200, height: 200, borderRadius: 100, overflow: 'hidden', border: '4px solid rgba(184,156,251,0.5)', background: '#1A1326', alignItems: 'center', justifyContent: 'center', marginBottom: 36 }}>
          {avatar
            ? <img src={avatar} width={200} height={200} style={{ objectFit: 'cover' }} />
            : <div style={{ fontSize: 96, color: '#8B5CF6', display: 'flex' }}>{initial}</div>}
        </div>
        <div style={{ fontSize: 64, fontWeight: 700, display: 'flex' }}>{name}</div>
        <div style={{ fontSize: 30, color: '#B89CFB', marginTop: 10, display: 'flex' }}>{sub}</div>
        <div style={{ position: 'absolute', bottom: 48, fontSize: 24, color: 'rgba(245,241,250,0.55)', display: 'flex' }}>Powered by Noxa</div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
