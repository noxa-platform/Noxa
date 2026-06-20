// 既存 profile_pages に visibility が無いdocへ、published から導出した値を付与する。
// 冪等（再実行で visibility 既設のdocはスキップ）。
// 実行: GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/application_default_credentials.json \
//         node scripts/migrate-profile-visibility.mjs
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'noxa-platform' });
const db = getFirestore();

const snap = await db.collection('profile_pages').get();
let updated = 0, skipped = 0;
const batch = db.batch();
for (const d of snap.docs) {
  const data = d.data();
  if (data.visibility) { skipped++; continue; }
  const visibility = data.published ? 'public' : 'private';
  batch.update(d.ref, { visibility });
  updated++;
}
if (updated > 0) await batch.commit();
console.log(`profile_pages 移行完了: 更新 ${updated} / スキップ(既にvisibilityあり) ${skipped} / 全 ${snap.size}`);
process.exit(0);
