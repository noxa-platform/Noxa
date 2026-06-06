import { buildProfileOg, OG_SIZE } from '@/lib/profileOg';
export const runtime = 'edge';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'Noxa Shop';
export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return buildProfileOg(handle, 'shop');
}
