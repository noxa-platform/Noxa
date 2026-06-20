import type { Metadata } from 'next';
import { resolveVisibility } from '@/lib/visibility';
import { PublicProfile } from '@/components/profile/PublicProfile';

// public のみ検索インデックス許可。unlisted/private/未取得は noindex。
// Firestore REST で読む（private は匿名 read がルールで 403 → null → noindex 扱い）。
async function readVisibility(handle: string): Promise<string> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/noxa-platform/databases/(default)/documents/profile_pages/${encodeURIComponent(handle.toLowerCase())}`;
    const res = await fetch(url);
    if (!res.ok) return 'private';
    const json = (await res.json()) as { fields?: Record<string, { stringValue?: string; booleanValue?: boolean }> };
    const f = json.fields ?? {};
    return resolveVisibility({ visibility: f.visibility?.stringValue, published: f.published?.booleanValue });
  } catch {
    return 'private';
  }
}

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const vis = await readVisibility(handle);
  if (vis !== 'public') return { robots: { index: false, follow: false } };
  return {};
}

export default async function Page({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <PublicProfile handle={handle} expectType="user" />;
}
