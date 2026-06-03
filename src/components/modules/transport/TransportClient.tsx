'use client';
import type { User } from 'firebase/auth';
import { ShopCollectionClient } from '@/components/modules/_shared/ShopCollectionClient';
export function TransportClient({ user }: { user: User }) {
  return <ShopCollectionClient user={user} config={{
    title: '送迎', eyebrow: 'Noxa OS · Transport', crumb: 'transport', collection: 'transport',
    emptyHint: '送迎の手配を追加してください。',
    fields: [
      { key: 'name', label: '対象', type: 'text', primary: true, flex: 2, placeholder: '顧客名 / キャスト名' },
      { key: 'area', label: '方面', type: 'text', placeholder: '難波/梅田…' },
      { key: 'time', label: '時刻', type: 'text', placeholder: '例：23:30' },
      { key: 'driver', label: 'ドライバー', type: 'text' },
      { key: 'status', label: 'ステータス', type: 'select', options: ['依頼', '手配済', '完了'] },
    ],
  }} />;
}
export default TransportClient;
