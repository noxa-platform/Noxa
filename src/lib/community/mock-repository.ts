/**
 * インメモリのモック実装（CommunityRepository）。
 *
 * 永続化なし。プロセス内（＝ブラウザのタブ寿命）で状態を保持する。リロードで初期化。
 * 1 ウェッジ MVP（大阪ミナミ × ホスト）に合わせ、関西・ホスト寄りのシードで
 * 「人がいる感」を作る。Firestore 実装に差し替えるときは本ファイルを置換するだけ。
 */

import type { Board, Reply, Thread } from './types';
import type {
  AddReplyInput,
  CommunityRepository,
  CreateThreadInput,
  LikeTarget,
  ReportTarget,
} from './repository';
import type { ThreadFilter } from './types';

// 6 板（出稼ぎ＝差別化の一等地、雑談＝ウェッジの volume ドライバ）
const BOARDS: Board[] = [
  { id: 'zatsudan', name: '雑談・愚痴', desc: '今日の出来事、ちょっとした愚痴、なんでもどうぞ。', threadCount: 412, postsToday: 87, lastActivity: 'たった今', wedge: true },
  { id: 'settai', name: '接客・客対応の悩み', desc: '指名・同伴・太客対応のリアルな相談。', threadCount: 238, postsToday: 41, lastActivity: '2分前', wedge: true },
  { id: 'dekasegi', name: '出稼ぎ情報', desc: 'エリア・期間・業態別の出稼ぎ情報。ここだけの一次情報。', threadCount: 156, postsToday: 33, lastActivity: '4分前', featured: true },
  { id: 'biyou', name: '美容・ファッション', desc: 'メイク・ネイル・衣装・ボディメイクの情報交換。', threadCount: 174, postsToday: 22, lastActivity: '11分前' },
  { id: 'okane', name: 'お金（税金・確定申告・寮）', desc: '確定申告・税金・寮・貯金。お金まわりの実務。', threadCount: 98, postsToday: 9, lastActivity: '38分前' },
  { id: 'news', name: '業界ニュース', desc: '法改正・業界の動き・運営からのお知らせ。', threadCount: 47, postsToday: 4, lastActivity: '1時間前' },
];

function seedThreads(): Thread[] {
  return [
    {
      id: 't-deka-1', boardId: 'dekasegi',
      title: '【ピン留め】出稼ぎ予定を書き込むスレ（行き先・期間・業態）',
      anonId: '運営', postedAt: '3日前', lastActivity: '4分前',
      body: 'これから出稼ぎに行く予定の人が、行き先エリア・滞在期間・業態をゆるく共有するスレです。同時期・同エリアの人と情報を合わせる用にどうぞ。店名・連絡先・個人情報は書かないでください。',
      pinned: true, likeCount: 64, areaTag: '関西',
      replies: [
        { id: 'r1', resNo: 2, anonId: 'a91f', postedAt: '2時間前', body: '来月あたまから2週間、関西いきます。はじめての土地なので雰囲気だけでも知りたいです。', likeCount: 8, areaTag: '関西', jobTag: 'キャバ・ガルバ' },
        { id: 'r2', resNo: 3, anonId: 'c7b2', postedAt: '1時間前', body: '同じく関西組です。短期だと寮の有無で全然違うので、そこは事前に確認したほうがいいですよ。', likeCount: 12, areaTag: '関西' },
        { id: 'r3', resNo: 4, anonId: 'd0e8', postedAt: '4分前', body: '九州から関西に移動予定。気候差で体調崩しがちなので無理しないようにしてます。', likeCount: 3, areaTag: '九州', jobTag: '風俗' },
      ],
    },
    {
      id: 't-deka-2', boardId: 'dekasegi',
      title: '出稼ぎ体験レポを淡々と書くスレ',
      anonId: 'b3a1', postedAt: '1日前', lastActivity: '20分前',
      body: '行ってよかった・しんどかったを、店名出さずに体験ベースで残すスレ。次に行く人の参考になれば。',
      pinned: true, likeCount: 41,
      replies: [
        { id: 'r4', resNo: 2, anonId: 'f22a', postedAt: '40分前', body: '初出稼ぎ、移動費と滞在費の計算が甘くて思ったより残らなかった。次は事前にちゃんと見積もる。', likeCount: 19 },
        { id: 'r5', resNo: 3, anonId: '9c1d', postedAt: '20分前', body: '体感ですが、土地勘ないうちは無理に営業時間伸ばさないほうが結果よかったです。', likeCount: 7 },
      ],
    },
    {
      id: 't-zatsu-1', boardId: 'zatsudan',
      title: '退勤後ごはん、結局なに食べてる？',
      anonId: '4d7e', postedAt: '5時間前', lastActivity: 'たった今',
      body: '深夜に帰ってから食べると太るのはわかってるけど、空腹で寝れない。みんな何で乗り切ってる？',
      likeCount: 28, areaTag: '関西',
      replies: [
        { id: 'r6', resNo: 2, anonId: 'aa01', postedAt: '3時間前', body: 'スープ系にしてからマシになった。固形より罪悪感少ない気がする。', likeCount: 14, areaTag: '関西', jobTag: 'ホスト' },
        { id: 'r7', resNo: 3, anonId: 'bb12', postedAt: '1時間前', body: '結局食べちゃうけど、その分翌日の昼を抜いて帳尻合わせてる。', likeCount: 5 },
        { id: 'r8', resNo: 4, anonId: 'cc23', postedAt: 'たった今', body: 'わかる。寝る前の空腹がいちばん敵。', likeCount: 1, areaTag: '関西', jobTag: 'ホスト' },
      ],
    },
    {
      id: 't-settai-1', boardId: 'settai',
      title: '太客の誕生日フォロー、どこまでやってる？',
      anonId: '7f3c', postedAt: '8時間前', lastActivity: '12分前',
      body: '手書きメッセージは続けてるけど、最近みんなレベル高くて差をつけられてる気がする。やりすぎない範囲でできること知りたい。',
      likeCount: 33, areaTag: '関西', jobTag: 'ホスト',
      replies: [
        { id: 'r9', resNo: 2, anonId: 'e5f6', postedAt: '5時間前', body: '前日の夜に一言だけ連絡、当日は重くしすぎない。これくらいがちょうどいい距離感かなと。', likeCount: 22, areaTag: '関西', jobTag: 'ホスト' },
        { id: 'r10', resNo: 3, anonId: 'a7b8', postedAt: '12分前', body: 'ギフトより「覚えててくれた」が効くタイプの客もいるので、相手で変えてます。', likeCount: 9 },
      ],
    },
    {
      id: 't-settai-2', boardId: 'settai',
      title: '指名がしばらく続いた客の引き際、どう見てる？',
      anonId: '2e9a', postedAt: '6時間前', lastActivity: '1時間前',
      body: '熱量が落ちてきたかな、という客への接し方。粘るのか、引くのか、みんなの判断基準が知りたい。',
      likeCount: 24, areaTag: '関西', jobTag: 'ホスト',
      replies: [
        { id: 'r11', resNo: 2, anonId: 'b8c4', postedAt: '2時間前', body: '無理に引き止めない。離れてもまた戻ってくる関係のほうが結局長い。', likeCount: 15, areaTag: '関西', jobTag: 'ホスト' },
      ],
    },
    {
      id: 't-okane-1', boardId: 'okane',
      title: '確定申告、毎年ギリギリになる人集合',
      anonId: '1a2b', postedAt: '昨日', lastActivity: '38分前',
      body: '領収書ためがち。みんな経費どこまで入れてる？（具体的な店名・金額は伏せて一般論で）',
      likeCount: 17,
      replies: [
        { id: 'r12', resNo: 2, anonId: 'd4c5', postedAt: '50分前', body: '衣装・美容まわりは入れてる。判断つかないのは結局税理士に投げた。', likeCount: 11 },
      ],
    },
  ];
}

export class MockCommunityRepository implements CommunityRepository {
  private boards: Board[];
  private threads: Thread[];
  private seq = 1000;

  constructor() {
    this.boards = BOARDS.map((b) => ({ ...b }));
    this.threads = seedThreads();
  }

  async listBoards(): Promise<Board[]> {
    return this.boards.map((b) => ({ ...b }));
  }

  async listThreads(boardId: string, filter?: ThreadFilter): Promise<Thread[]> {
    let list = this.threads.filter((t) => t.boardId === boardId);
    if (filter?.areaTag) list = list.filter((t) => t.areaTag === filter.areaTag);
    if (filter?.jobTag) list = list.filter((t) => t.jobTag === filter.jobTag);
    // ピン留め優先（安定ソート）
    const sorted = [...list].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
    return sorted.map((t) => this.clone(t));
  }

  async getThread(threadId: string): Promise<Thread | null> {
    const t = this.threads.find((x) => x.id === threadId);
    return t ? this.clone(t) : null;
  }

  async createThread(input: CreateThreadInput): Promise<Thread> {
    this.seq += 1;
    const thread: Thread = {
      id: `t-new-${this.seq}`,
      boardId: input.boardId,
      title: input.title,
      anonId: 'あなた',
      postedAt: 'たった今',
      lastActivity: 'たった今',
      body: input.body,
      replies: [],
      areaTag: input.areaTag,
      jobTag: input.jobTag,
      likeCount: 0,
    };
    this.threads = [thread, ...this.threads];
    return this.clone(thread);
  }

  async addReply(threadId: string, input: AddReplyInput): Promise<Thread> {
    const t = this.threads.find((x) => x.id === threadId);
    if (!t) throw new Error(`thread not found: ${threadId}`);
    this.seq += 1;
    const reply: Reply = {
      id: `r-new-${this.seq}`,
      resNo: t.replies.length + 2,
      anonId: 'あなた',
      postedAt: 'たった今',
      body: input.body,
      likeCount: 0,
      areaTag: input.areaTag,
      jobTag: input.jobTag,
    };
    t.replies.push(reply);
    t.lastActivity = 'たった今';
    return this.clone(t);
  }

  async toggleLike(target: LikeTarget, liked: boolean): Promise<Thread> {
    const t = this.threads.find((x) => x.id === target.threadId);
    if (!t) throw new Error(`thread not found: ${target.threadId}`);
    const delta = liked ? -1 : 1;
    if (target.kind === 'thread') {
      t.likeCount = Math.max(0, t.likeCount + delta);
    } else {
      const r = t.replies.find((x) => x.id === target.replyId);
      if (r) r.likeCount = Math.max(0, r.likeCount + delta);
    }
    return this.clone(t);
  }

  async report(_target: ReportTarget): Promise<void> {
    // モックでは記録のみ（no-op）。実装時は noxa_reports に作成し通報3回で自動非表示。
    void _target;
  }

  // 外部に内部参照を漏らさないためのディープコピー
  private clone(t: Thread): Thread {
    return { ...t, replies: t.replies.map((r) => ({ ...r })) };
  }
}
