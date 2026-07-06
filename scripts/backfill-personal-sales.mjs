/**
 * 旧 CF 個人売上控え（personal_sales/{uid}/items）の dayKey / amount バックフィル。
 *
 * 背景（Day11・グラインド M4 で発見した断線の過去分回収）:
 *   sales-sync CF の旧仕様は控えに salesAmount/datetime しか書いておらず、
 *   個人売上画面（SalesClient）が使う amount（表示）と dayKey（当月範囲購読）が無い。
 *   新規会計は修正済み CF が書くため自動解消。このスクリプトは過去分を埋める。
 *
 * 安全設計:
 *   - 既定は dry-run（何も書かない・変更予定を表示するだけ）。書込は --apply 明示時のみ
 *   - 対象は source=='shop' かつ dayKey 欠落の控えのみ（新仕様 doc・手入力 doc は触らない）
 *   - dayKey は紐付く店舗売上（shop_shops/{shopId}/sales/{shopSaleId}）の dayKey を正とし、
 *     参照できない場合のみ datetime から JST 営業日（6時切替）で算出
 *   - 既存フィールドの上書きはしない（欠けているキーだけ set(merge)）
 *
 * 前提: `gcloud auth application-default login` 済み（ADC）。
 * 使い方（noxa/ で・functions の node_modules を利用）:
 *   NODE_PATH=functions/node_modules node scripts/backfill-personal-sales.mjs            # dry-run
 *   NODE_PATH=functions/node_modules node scripts/backfill-personal-sales.mjs --apply    # 書込実行（人間承認後）
 */

import admin from 'firebase-admin';

const PROJECT_ID = 'noxa-platform';
const APPLY = process.argv.includes('--apply');
const BATCH_LIMIT = 400;

admin.initializeApp({
  projectId: PROJECT_ID,
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

/** datetime(Timestamp) → JST 営業日キー（6時切替・src/lib/datetime.businessDayKey と同義） */
function businessDayKeyJst(ts) {
  if (!ts || typeof ts.toMillis !== 'function') return null;
  const jst = new Date(ts.toMillis() + 9 * 60 * 60 * 1000); // UTC メソッドで JST を読む
  if (jst.getUTCHours() < 6) jst.setUTCDate(jst.getUTCDate() - 1);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function main() {
  console.log(`[backfill-personal-sales] mode=${APPLY ? 'APPLY（書込あり）' : 'dry-run（書込なし）'}`);

  // collectionGroup('items') は personal_customers 等の items も拾うため、
  // source=='shop' フィルタ＋パス接頭辞チェックの二段で personal_sales の CF 控えに限定する
  const snap = await db.collectionGroup('items').where('source', '==', 'shop').get();
  console.log(`source=='shop' の items: ${snap.size} 件`);

  const fixes = [];
  let skippedPath = 0;
  let alreadyOk = 0;
  for (const doc of snap.docs) {
    if (!doc.ref.path.startsWith('personal_sales/')) { skippedPath += 1; continue; }
    const d = doc.data();
    const hasDayKey = typeof d.dayKey === 'string' && d.dayKey.length === 10;
    const hasAmount = typeof d.amount === 'number';
    if (hasDayKey && hasAmount) { alreadyOk += 1; continue; }

    // dayKey の正は店舗売上 doc（CF と同じソース）。読めなければ datetime から算出
    let dayKey = hasDayKey ? d.dayKey : null;
    if (!dayKey && typeof d.shopId === 'string' && typeof d.shopSaleId === 'string') {
      try {
        const sale = await db.doc(`shop_shops/${d.shopId}/sales/${d.shopSaleId}`).get();
        const sk = sale.exists ? sale.data()?.dayKey : null;
        if (typeof sk === 'string') dayKey = sk;
      } catch { /* fallthrough */ }
    }
    if (!dayKey) dayKey = businessDayKeyJst(d.datetime);

    const patch = {};
    if (!hasDayKey && dayKey) patch.dayKey = dayKey;
    if (!hasAmount && typeof d.salesAmount === 'number') patch.amount = d.salesAmount;
    if (Object.keys(patch).length === 0) continue;
    fixes.push({ ref: doc.ref, patch });
  }

  console.log(`パス対象外スキップ: ${skippedPath} / 既に正常: ${alreadyOk} / 修正対象: ${fixes.length}`);
  for (const f of fixes.slice(0, 20)) console.log(`  ${f.ref.path} <- ${JSON.stringify(f.patch)}`);
  if (fixes.length > 20) console.log(`  …ほか ${fixes.length - 20} 件`);

  if (!APPLY) {
    console.log('dry-run のため書込なし。実行するには --apply を付けてください。');
    return;
  }
  for (let i = 0; i < fixes.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const f of fixes.slice(i, i + BATCH_LIMIT)) {
      batch.set(f.ref, { ...f.patch, backfilledAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    await batch.commit();
    console.log(`書込 ${Math.min(i + BATCH_LIMIT, fixes.length)}/${fixes.length}`);
  }
  console.log('完了。');
}

main().catch((e) => { console.error(e); process.exit(1); });
