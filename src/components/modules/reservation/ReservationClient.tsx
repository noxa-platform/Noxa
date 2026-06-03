'use client';
import type { User } from 'firebase/auth';
import { ShopCollectionClient } from '@/components/modules/_shared/ShopCollectionClient';
export function ReservationClient({ user }: { user: User }) {
  return <ShopCollectionClient user={user} config={{
    title: '予約・VIP', eyebrow: 'Noxa OS · Reservation', crumb: 'reservation', collection: 'reservations',
    emptyHint: '予約を追加してください。',
    fields: [
      { key: 'name', label: '顧客名', type: 'text', primary: true, flex: 2, placeholder: '例：佐藤様（VIP）' },
      { key: 'date', label: '日時', type: 'date' },
      { key: 'guests', label: '人数', type: 'number' },
      { key: 'cast', label: '担当', type: 'text' },
      { key: 'seat', label: '席', type: 'text' },
    ],
  }} />;
}
export default ReservationClient;
