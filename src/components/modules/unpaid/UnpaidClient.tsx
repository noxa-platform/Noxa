'use client';
import type { User } from 'firebase/auth';
import { ShopCollectionClient } from '@/components/modules/_shared/ShopCollectionClient';
export function UnpaidClient({ user }: { user: User }) {
  return <ShopCollectionClient user={user} config={{
    title: '売掛管理', eyebrow: 'Noxa OS · Unpaid', crumb: 'unpaid', collection: 'unpaid', sensitive: true,
    emptyHint: '売掛（未回収）を登録してください。',
    fields: [
      { key: 'name', label: '顧客名', type: 'text', primary: true, flex: 2 },
      { key: 'amount', label: '金額', type: 'money' },
      { key: 'date', label: '発生日', type: 'date' },
      { key: 'due', label: '期日', type: 'date' },
      { key: 'status', label: 'ステータス', type: 'select', options: ['未回収', '一部回収', '回収済'] },
    ],
  }} />;
}
export default UnpaidClient;
