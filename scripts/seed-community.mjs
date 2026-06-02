/**
 * NOXA コミュニティの初期シード投入スクリプト（firebase-admin / ADC）。
 *
 * 本番 noxa-platform は yorulog / nomishugy と共有する本番 DB。実行は手動・要確認。
 *
 * 前提:
 *   - `gcloud auth application-default login` 済み（ADC）
 *   - firebase-admin が解決できること（例: functions/ の node_modules を使う）
 *
 * 使い方（noxa/ で）:
 *   node --experimental-specifier-resolution=node scripts/seed-community.mjs            # 板のみ（冪等）
 *   node scripts/seed-community.mjs --with-threads                                       # 板 + シードスレッド/レス
 *
 * 板は固定 ID で setDoc するので再実行しても重複しない。スレッドは --with-threads 指定時のみ、
 * 既に seed 済み（marker ドキュメント）ならスキップする。
 */

import admin from 'firebase-admin';

const PROJECT_ID = 'noxa-platform';
const WITH_THREADS = process.argv.includes('--with-threads');

admin.initializeApp({
  projectId: PROJECT_ID,
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

const minutesAgo = (m) => Timestamp.fromMillis(Date.now() - m * 60_000);

// 6 板（出稼ぎ=差別化の一等地、雑談=ウェッジの volume ドライバ）
const BOARDS = [
  { id: 'zatsudan', name: '雑談・愚痴', desc: '今日の出来事、ちょっとした愚痴、なんでもどうぞ。', order: 1, threadCount: 412, postsToday: 87, wedge: true },
  { id: 'settai', name: '接客・客対応の悩み', desc: '指名・同伴・太客対応のリアルな相談。', order: 2, threadCount: 238, postsToday: 41, wedge: true },
  { id: 'dekasegi', name: '出稼ぎ情報', desc: 'エリア・期間・業態別の出稼ぎ情報。ここだけの一次情報。', order: 3, threadCount: 156, postsToday: 33, featured: true },
  { id: 'biyou', name: '美容・ファッション', desc: 'メイク・ネイル・衣装・ボディメイクの情報交換。', order: 4, threadCount: 174, postsToday: 22 },
  { id: 'okane', name: 'お金（税金・確定申告・寮）', desc: '確定申告・税金・寮・貯金。お金まわりの実務。', order: 5, threadCount: 98, postsToday: 9 },
  { id: 'news', name: '業界ニュース', desc: '法改正・業界の動き・運営からのお知らせ。', order: 6, threadCount: 47, postsToday: 4 },
];

// シードスレッド（authorUid は seed 用。表示は anonId(uid,postId) で完全匿名）
const THREADS = [
  {
    boardId: 'dekasegi', authorUid: 'seed-official', pinned: true, official: true, areaTag: '関西',
    title: '【ピン留め】出稼ぎ予定を書き込むスレ（行き先・期間・業態）', minAgo: 4320,
    body: 'これから出稼ぎに行く予定の人が、行き先エリア・滞在期間・業態をゆるく共有するスレです。同時期・同エリアの人と情報を合わせる用にどうぞ。店名・連絡先・個人情報は書かないでください。',
    replies: [
      { authorUid: 'seed-a91f', minAgo: 120, body: '来月あたまから2週間、関西いきます。はじめての土地なので雰囲気だけでも知りたいです。', areaTag: '関西', jobTag: 'キャバ・ガルバ' },
      { authorUid: 'seed-c7b2', minAgo: 60, body: '同じく関西組です。短期だと寮の有無で全然違うので、そこは事前に確認したほうがいいですよ。', areaTag: '関西' },
      { authorUid: 'seed-d0e8', minAgo: 4, body: '九州から関西に移動予定。気候差で体調崩しがちなので無理しないようにしてます。', areaTag: '九州', jobTag: '風俗' },
    ],
  },
  {
    boardId: 'zatsudan', authorUid: 'seed-4d7e', areaTag: '関西',
    title: '退勤後ごはん、結局なに食べてる？', minAgo: 300,
    body: '深夜に帰ってから食べると太るのはわかってるけど、空腹で寝れない。みんな何で乗り切ってる？',
    replies: [
      { authorUid: 'seed-aa01', minAgo: 180, body: 'スープ系にしてからマシになった。固形より罪悪感少ない気がする。', areaTag: '関西', jobTag: 'ホスト' },
      { authorUid: 'seed-bb12', minAgo: 60, body: '結局食べちゃうけど、その分翌日の昼を抜いて帳尻合わせてる。' },
    ],
  },
  {
    boardId: 'settai', authorUid: 'seed-7f3c', areaTag: '関西', jobTag: 'ホスト',
    title: '太客の誕生日フォロー、どこまでやってる？', minAgo: 480,
    body: '手書きメッセージは続けてるけど、最近みんなレベル高くて差をつけられてる気がする。やりすぎない範囲でできること知りたい。',
    replies: [
      { authorUid: 'seed-e5f6', minAgo: 300, body: '前日の夜に一言だけ連絡、当日は重くしすぎない。これくらいがちょうどいい距離感かなと。', areaTag: '関西', jobTag: 'ホスト' },
    ],
  },
];

async function seedBoards() {
  const batch = db.batch();
  for (const b of BOARDS) {
    const { id, ...rest } = b;
    batch.set(db.collection('noxa_boards').doc(id), {
      ...rest,
      lastActivityAt: minutesAgo(2),
    }, { merge: true });
  }
  await batch.commit();
  console.log(`板 ${BOARDS.length} 件を投入（merge）`);
}

async function seedThreads() {
  const marker = db.collection('noxa_meta').doc('community_seed');
  const m = await marker.get();
  if (m.exists && m.data()?.threadsSeeded) {
    console.log('シードスレッドは投入済み。スキップ。');
    return;
  }
  for (const t of THREADS) {
    const postRef = db.collection('noxa_posts').doc();
    await postRef.set({
      boardId: t.boardId,
      title: t.title,
      body: t.body,
      authorUid: t.authorUid,
      areaTag: t.areaTag ?? null,
      jobTag: t.jobTag ?? null,
      pinned: t.pinned ?? false,
      official: t.official ?? false,
      likeCount: 0,
      commentCount: t.replies.length,
      createdAt: minutesAgo(t.minAgo),
      lastActivityAt: minutesAgo(t.replies.at(-1)?.minAgo ?? t.minAgo),
    });
    let resNo = 2;
    for (const r of t.replies) {
      await db.collection('noxa_comments').add({
        postId: postRef.id,
        resNo: resNo++,
        authorUid: r.authorUid,
        body: r.body,
        areaTag: r.areaTag ?? null,
        jobTag: r.jobTag ?? null,
        likeCount: 0,
        createdAt: minutesAgo(r.minAgo),
      });
    }
    console.log(`スレッド投入: ${t.title}（レス ${t.replies.length}）`);
  }
  await marker.set({ threadsSeeded: true, seededAt: FieldValue.serverTimestamp() }, { merge: true });
}

async function main() {
  console.log(`project=${PROJECT_ID} with-threads=${WITH_THREADS}`);
  await seedBoards();
  if (WITH_THREADS) await seedThreads();
  console.log('完了');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
