/**
 * インメモリのモック実装（CommunityRepository）。
 *
 * 永続化なし。プロセス内（＝ブラウザのタブ寿命）で状態を保持する。リロードで初期化。
 * 1 ウェッジ MVP（大阪ミナミ × ホスト）に合わせ、関西・ホスト寄りのシードで
 * 「人がいる感」を作る。Firestore 実装に差し替えるときは本ファイルを置換するだけ。
 *
 * 内部では authorUid を保持し、読み出し時に表示用フラグ（isMine / isThreadAuthor / official）と
 * 匿名 ID を計算して、ドメイン型（authorUid を含まない）に変換して返す。
 */

import type { Board, Reply, Thread } from './types';
import type {
  AddReplyInput, CommunityRepository, CreateThreadInput, LikeTarget, ReportTarget, ThreadFilter,
} from './repository';
import { anonId, todayKey } from './anon-id';

// 内部表現（authorUid を持つ。表には出さない）
type SeedReply = Reply & { authorUid: string };
type SeedThread = Omit<Thread, 'replies'> & { authorUid: string; replies: SeedReply[] };

// モックの閲覧者 uid（自分マーク判定用）
const ME = 'me';

// 6 板（出稼ぎ＝差別化の一等地、雑談＝ウェッジの volume ドライバ）
const BOARDS: Board[] = [
  { id: 'zatsudan', name: '雑談・愚痴', desc: '今日の出来事、ちょっとした愚痴、なんでもどうぞ。', threadCount: 412, postsToday: 87, lastActivity: 'たった今', wedge: true },
  { id: 'settai', name: '接客・客対応の悩み', desc: '指名・同伴・太客対応のリアルな相談。', threadCount: 238, postsToday: 41, lastActivity: '2分前', wedge: true },
  { id: 'dekasegi', name: '出稼ぎ情報', desc: 'エリア・期間・業態別の出稼ぎ情報。ここだけの一次情報。', threadCount: 156, postsToday: 33, lastActivity: '4分前', featured: true },
  { id: 'biyou', name: '美容・ファッション', desc: 'メイク・ネイル・衣装・ボディメイクの情報交換。', threadCount: 174, postsToday: 22, lastActivity: '11分前' },
  { id: 'okane', name: 'お金（税金・確定申告・寮）', desc: '確定申告・税金・寮・貯金。お金まわりの実務。', threadCount: 98, postsToday: 9, lastActivity: '38分前' },
  { id: 'news', name: '業界ニュース', desc: '法改正・業界の動き・運営からのお知らせ。', threadCount: 47, postsToday: 4, lastActivity: '1時間前' },
];

function r(id: string, resNo: number, anon: string, authorUid: string, postedAt: string, body: string, likeCount: number, areaTag?: Reply['areaTag'], jobTag?: Reply['jobTag']): SeedReply {
  return { id, resNo, anonId: anon, authorUid, postedAt, body, likeCount, areaTag, jobTag };
}

function seedThreads(): SeedThread[] {
  return [
    {
      id: 't-deka-1', boardId: 'dekasegi',
      title: '【ピン留め】出稼ぎ予定を書き込むスレ（行き先・期間・業態）',
      anonId: '0000', authorUid: 'u-official', official: true, postedAt: '3日前', lastActivity: '4分前',
      body: 'これから出稼ぎに行く予定の人が、行き先エリア・滞在期間・業態をゆるく共有するスレです。同時期・同エリアの人と情報を合わせる用にどうぞ。店名・連絡先・個人情報は書かないでください。',
      pinned: true, likeCount: 64, areaTag: '関西',
      replies: [
        r('r1', 2, 'a91f', 'u-a91f', '2時間前', '来月あたまから2週間、関西いきます。はじめての土地なので雰囲気だけでも知りたいです。', 8, '関西', 'キャバ・ガルバ'),
        r('r2', 3, 'c7b2', 'u-c7b2', '1時間前', '同じく関西組です。短期だと寮の有無で全然違うので、そこは事前に確認したほうがいいですよ。', 12, '関西'),
        r('r3', 4, 'd0e8', 'u-d0e8', '4分前', '九州から関西に移動予定。気候差で体調崩しがちなので無理しないようにしてます。', 3, '九州', '風俗'),
      ],
    },
    {
      id: 't-deka-2', boardId: 'dekasegi',
      title: '出稼ぎ体験レポを淡々と書くスレ',
      anonId: 'b3a1', authorUid: 'u-b3a1', postedAt: '1日前', lastActivity: '20分前',
      body: '行ってよかった・しんどかったを、店名出さずに体験ベースで残すスレ。次に行く人の参考になれば。',
      pinned: true, likeCount: 41,
      replies: [
        r('r4', 2, 'f22a', 'u-f22a', '40分前', '初出稼ぎ、移動費と滞在費の計算が甘くて思ったより残らなかった。次は事前にちゃんと見積もる。', 19),
        r('r5', 3, 'b3a1', 'u-b3a1', '20分前', '※スレ主です。補足すると、初週は無理せず様子見が結局いちばん効率よかったです。', 7),
      ],
    },
    {
      id: 't-zatsu-1', boardId: 'zatsudan',
      title: '退勤後ごはん、結局なに食べてる？',
      anonId: '4d7e', authorUid: 'u-4d7e', postedAt: '5時間前', lastActivity: 'たった今',
      body: '深夜に帰ってから食べると太るのはわかってるけど、空腹で寝れない。みんな何で乗り切ってる？',
      likeCount: 28, areaTag: '関西',
      replies: [
        r('r6', 2, 'aa01', 'u-aa01', '3時間前', 'スープ系にしてからマシになった。固形より罪悪感少ない気がする。', 14, '関西', 'ホスト'),
        r('r7', 3, 'bb12', 'u-bb12', '1時間前', '結局食べちゃうけど、その分翌日の昼を抜いて帳尻合わせてる。', 5),
        r('r8', 4, '4d7e', 'u-4d7e', 'たった今', '※スレ主です。やっぱりスープ派多いんですね。試してみます。', 1),
      ],
    },
    {
      id: 't-settai-1', boardId: 'settai',
      title: '太客の誕生日フォロー、どこまでやってる？',
      anonId: '7f3c', authorUid: 'u-7f3c', postedAt: '8時間前', lastActivity: '12分前',
      body: '手書きメッセージは続けてるけど、最近みんなレベル高くて差をつけられてる気がする。やりすぎない範囲でできること知りたい。',
      likeCount: 33, areaTag: '関西', jobTag: 'ホスト',
      replies: [
        r('r9', 2, 'e5f6', 'u-e5f6', '5時間前', '前日の夜に一言だけ連絡、当日は重くしすぎない。これくらいがちょうどいい距離感かなと。', 22, '関西', 'ホスト'),
        r('r10', 3, 'a7b8', 'u-a7b8', '12分前', 'ギフトより「覚えててくれた」が効くタイプの客もいるので、相手で変えてます。', 9),
      ],
    },
    {
      id: 't-okane-1', boardId: 'okane',
      title: '確定申告、毎年ギリギリになる人集合',
      anonId: '1a2b', authorUid: 'u-1a2b', postedAt: '昨日', lastActivity: '38分前',
      body: '領収書ためがち。みんな経費どこまで入れてる？（具体的な店名・金額は伏せて一般論で）',
      likeCount: 17,
      replies: [
        r('r11', 2, 'd4c5', 'u-d4c5', '50分前', '衣装・美容まわりは入れてる。判断つかないのは結局税理士に投げた。', 11),
      ],
    },
  ];
}

export class MockCommunityRepository implements CommunityRepository {
  private boards: Board[];
  private threads: SeedThread[];
  private seq = 1000;

  constructor(private readonly uid: string = ME) {
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
    const sorted = [...list].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
    return sorted.map((t) => this.toDomain(t));
  }

  async getThread(threadId: string): Promise<Thread | null> {
    const t = this.threads.find((x) => x.id === threadId);
    return t ? this.toDomain(t) : null;
  }

  async createThread(input: CreateThreadInput): Promise<Thread> {
    this.seq += 1;
    const thread: SeedThread = {
      id: `t-new-${this.seq}`,
      boardId: input.boardId,
      title: input.title,
      anonId: anonId(this.uid, input.boardId, todayKey()),
      authorUid: this.uid,
      postedAt: 'たった今',
      lastActivity: 'たった今',
      body: input.body,
      replies: [],
      areaTag: input.areaTag,
      jobTag: input.jobTag,
      likeCount: 0,
    };
    this.threads = [thread, ...this.threads];
    return this.toDomain(thread);
  }

  async addReply(threadId: string, input: AddReplyInput): Promise<Thread> {
    const t = this.threads.find((x) => x.id === threadId);
    if (!t) throw new Error(`thread not found: ${threadId}`);
    this.seq += 1;
    t.replies.push({
      id: `r-new-${this.seq}`,
      resNo: t.replies.length + 2,
      anonId: anonId(this.uid, t.boardId, todayKey()),
      authorUid: this.uid,
      postedAt: 'たった今',
      body: input.body,
      likeCount: 0,
      areaTag: input.areaTag,
      jobTag: input.jobTag,
    });
    t.lastActivity = 'たった今';
    return this.toDomain(t);
  }

  async toggleLike(target: LikeTarget, liked: boolean): Promise<Thread> {
    const t = this.threads.find((x) => x.id === target.threadId);
    if (!t) throw new Error(`thread not found: ${target.threadId}`);
    const delta = liked ? -1 : 1;
    if (target.kind === 'thread') {
      t.likeCount = Math.max(0, t.likeCount + delta);
    } else {
      const reply = t.replies.find((x) => x.id === target.replyId);
      if (reply) reply.likeCount = Math.max(0, reply.likeCount + delta);
    }
    return this.toDomain(t);
  }

  async report(_target: ReportTarget): Promise<void> {
    // 通報受付のみ（記録の no-op）。自動非表示は今回スコープ外。
    void _target;
  }

  // 内部 SeedThread → ドメイン Thread（authorUid を落とし、表示用フラグを計算）
  private toDomain(t: SeedThread): Thread {
    return {
      id: t.id,
      boardId: t.boardId,
      title: t.title,
      anonId: t.anonId,
      postedAt: t.postedAt,
      lastActivity: t.lastActivity,
      body: t.body,
      areaTag: t.areaTag,
      jobTag: t.jobTag,
      pinned: t.pinned,
      likeCount: t.likeCount,
      replyCount: t.replies.length,
      isMine: t.authorUid === this.uid,
      official: t.official ?? false,
      replies: t.replies.map((rep) => {
        const { authorUid, ...rest } = rep;
        return {
          ...rest,
          isThreadAuthor: authorUid === t.authorUid,
          isMine: authorUid === this.uid,
        };
      }),
    };
  }
}
