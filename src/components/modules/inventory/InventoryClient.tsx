'use client';
import type { User } from 'firebase/auth';
import { ShopCollectionClient } from '@/components/modules/_shared/ShopCollectionClient';
export function InventoryClient({ user }: { user: User }) {
  return <ShopCollectionClient user={user} config={{
    title: '在庫', eyebrow: 'Noxa OS · Inventory', crumb: 'inventory', collection: 'inventory',
    emptyHint: '在庫品目を追加してください。',
    fields: [
      { key: 'name', label: '品名', type: 'text', primary: true, flex: 2, placeholder: '例：鏡月 / シャンパン' },
      { key: 'category', label: 'カテゴリ', type: 'select', options: ['ドリンク', 'フード', 'ボトル', '備品'] },
      { key: 'stock', label: '在庫数', type: 'number' },
      { key: 'par', label: '適正在庫', type: 'number' },
    ],
  }} />;
}
export default InventoryClient;
