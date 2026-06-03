'use client';
import type { User } from 'firebase/auth';
import { ShopCollectionClient } from '@/components/modules/_shared/ShopCollectionClient';
export function FirstVisitClient({ user }: { user: User }) {
  return <ShopCollectionClient user={user} config={{
    title: '初回案内', eyebrow: 'Noxa OS · First Visit', crumb: 'first-visit', collection: 'first_visits',
    emptyHint: '初回のお客様を登録してください。',
    fields: [
      { key: 'name', label: 'お名前', type: 'text', primary: true, flex: 2, placeholder: '例：田中様' },
      { key: 'source', label: '紹介元', type: 'text', placeholder: '看板/紹介/SNS' },
      { key: 'guests', label: '人数', type: 'number' },
      { key: 'cast', label: '担当', type: 'text' },
      { key: 'note', label: 'メモ', type: 'text' },
    ],
  }} />;
}
export default FirstVisitClient;
