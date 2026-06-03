'use client';
import type { User } from 'firebase/auth';
import { ShopCollectionClient } from '@/components/modules/_shared/ShopCollectionClient';
export function TrialClient({ user }: { user: User }) {
  return <ShopCollectionClient user={user} config={{
    title: '体験入店', eyebrow: 'Noxa OS · Trial', crumb: 'trial', collection: 'trials',
    emptyHint: '体験入店者を登録してください。',
    fields: [
      { key: 'name', label: '名前', type: 'text', primary: true, flex: 2 },
      { key: 'date', label: '日付', type: 'date' },
      { key: 'wage', label: '時給', type: 'money' },
      { key: 'rating', label: '評価', type: 'select', options: ['◎', '○', '△', '×'] },
      { key: 'note', label: 'メモ', type: 'text' },
    ],
  }} />;
}
export default TrialClient;
