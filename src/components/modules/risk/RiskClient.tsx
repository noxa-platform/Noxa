'use client';
import type { User } from 'firebase/auth';
import { ShopCollectionClient } from '@/components/modules/_shared/ShopCollectionClient';
export function RiskClient({ user }: { user: User }) {
  return <ShopCollectionClient user={user} config={{
    title: 'リスク客共有', eyebrow: 'Noxa OS · Risk', crumb: 'risk', collection: 'risk_customers', sensitive: true,
    emptyHint: '要注意客を共有登録してください。',
    fields: [
      { key: 'name', label: '顧客 / 特徴', type: 'text', primary: true, flex: 2 },
      { key: 'kind', label: '種別', type: 'select', options: ['出禁', '要注意', 'クレーム', '未払い'] },
      { key: 'detail', label: '内容', type: 'text', flex: 2 },
      { key: 'by', label: '共有者', type: 'text' },
    ],
  }} />;
}
export default RiskClient;
