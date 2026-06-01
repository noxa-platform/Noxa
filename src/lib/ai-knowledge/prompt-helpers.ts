import { getAdminDb } from '@/app/api/lib/firebase-admin';
import { buildPlaybookInstruction, resolveStoreHintKey } from './night-work-playbook';
import type { StoreType } from '@/lib/types';

// SelfBaseStyle の raw 形状（Firestore のドキュメント形）
// 型は types/index.ts の SelfBaseStyle と同等。こちらは any-ish な shape として使う。
export type SelfBaseStyleDoc = {
  stageName?: string;
  staffRole?: string;
  gender?: string;
  firstPerson?: string;
  defaultTone?: string;
  emojiLevel?: string;
  avgLength?: number;
  signaturePhrases?: string[];
  strongPoints?: string[];
  weakPoints?: string[];
  workStyle?: string;
};

// Workspace ドキュメントの店舗プロファイルとして AI に渡したいフィールド
export type StoreProfileDoc = {
  name?: string;            // ワークスペース名（個人 WS では「自分の記録」等、業務上の店舗名としては使わない場合あり）
  type?: 'personal' | 'business';
  storeTypeName?: string;   // 自由入力業種（例: 中小キャバ / メンズコンセプトカフェ）
  storeType?: string;       // 互換: enum 値（cabaret / host / lounge ...）
  address?: string;
  phoneNumber?: string;
  businessHours?: string;
};

const GENDER_LABELS: Record<string, string> = {
  female: '女性',
  male: '男性',
  other: '指定なし',
};

/**
 * 「絶対遵守事項」共通ブロック（v2.1 圧縮版・2026-05-12）。
 *
 * v2 では各ルールに違反例まで書いて約 250 tokens に膨らみ、DeepSeek 系で
 * 月コスト約 +44〜55% を引き起こした。v2.1 で約 1/3（80 tokens 前後）に圧縮。
 *
 * 圧縮戦略:
 *   - 違反例の冗長な列挙を削除（モデルは短い指示でも理解する）
 *   - 「致命的エラーと見なす」のような強調文も削除（指示自体の強さで十分）
 *   - 各ルールを 1 行に集約
 */
export const STRICT_RULES_BLOCK = `# 必須ルール
- 一人称はプロファイル指定の語のみ使う（源氏名を自称に置換しない）
- 標準語で書く（関西弁・方言は使わない）
- 提示データに無い固有名詞・銘柄・金額は作らない
- 絵文字はプロファイル指定の頻度で自然に使う（1 メッセージ 1〜2 個目安、絵文字ゼロにしない）
- ハート絵文字（💕💖🥰❤️💗💞🤍🩷）は使わない。筋肉絵文字（💪）も使わない（キモい）。代わりに 😊 ☺️ ✨ 😌 ☕ 🌙 🍻 などを文脈に応じて選ぶ
- テンプレ甘え表現は避ける（「癒してあげる」「癒しちゃう」「癒し」を多用しない、過剰なオラオラ営業文句も禁止）
- 自然な現代の口語で書く（テンプレ感・キャラ作り感が出ないこと）`;

// 自分のベース文体の内容をプロンプト向けテキストブロックに変換
// 何も設定がなければ空文字を返す
export function buildSelfBaseBlock(
  data: SelfBaseStyleDoc | null | undefined,
  heading = '## 自分のベース文体（必ず反映）'
): string {
  if (!data) return '';
  const parts = [
    data.stageName ? `名乗り（源氏名・他人から呼ばれる名前）: ${data.stageName}` : '',
    data.staffRole ? `自分の立場・職業: ${data.staffRole}` : '',
    data.gender ? `性別: ${GENDER_LABELS[data.gender] || data.gender}` : '',
    data.firstPerson ? `一人称（必ずこれを使う。源氏名と置換禁止）: ${data.firstPerson}` : '',
    data.defaultTone ? `基本トーン: ${data.defaultTone}` : '',
    data.emojiLevel ? `絵文字頻度: ${data.emojiLevel}` : '',
    data.avgLength ? `平均文字数: ${data.avgLength}` : '',
    data.signaturePhrases?.length ? `よく使う言い回し: ${data.signaturePhrases.join('、')}` : '',
    data.strongPoints?.length ? `強み: ${data.strongPoints.join('、')}` : '',
    data.weakPoints?.length ? `苦手な話題: ${data.weakPoints.join('、')}` : '',
    data.workStyle || '',
  ].filter(Boolean);
  if (parts.length === 0) return '';
  return `\n\n${heading}\n${parts.join('\n')}`;
}

/**
 * 店舗プロファイルブロック。
 * 事業ワークスペースの店舗情報（店舗名・業種・営業時間・住所など）を
 * プロンプトに乗せて、AI に「どの店舗で接客しているか」を意識させる。
 *
 * - 店舗業種 / 店舗名のどちらかが無いと block を出さない（情報量が少なすぎる）
 * - 個人 WS では事実上は出ないが、storeTypeName 等を入れていれば出る
 */
export function buildStoreProfileBlock(
  data: StoreProfileDoc | null | undefined,
  heading = '## 店舗プロファイル（接客文脈の前提として使う）',
): string {
  if (!data) return '';
  const minimalSignal = data.storeTypeName || data.name;
  if (!minimalSignal) return '';
  const isBusiness = data.type === 'business';
  const parts = [
    data.name ? `${isBusiness ? '店舗' : 'ワークスペース'}名: ${data.name}` : '',
    data.storeTypeName ? `業種: ${data.storeTypeName}` : (data.storeType ? `業種: ${data.storeType}` : ''),
    data.address ? `所在地: ${data.address}` : '',
    data.businessHours ? `営業時間: ${data.businessHours}` : '',
  ].filter(Boolean);
  if (parts.length === 0) return '';
  return `\n\n${heading}\n${parts.join('\n')}`;
}

import type { AccessContext } from '@/app/api/lib/access-context';
import { pathAiProfile } from '@/app/api/lib/access-context';

// 🔐 ctx (shop / personal) に基づいて適切な path から取得。
// 個人ユーザーが他人の shop データを覗けない設計。
export async function resolveWorkspaceContext(ctx: AccessContext) {
  const db = getAdminDb();
  let wsData: Record<string, unknown> | null = null;
  let selfData: SelfBaseStyleDoc | null = null;

  if (ctx.kind === 'shop') {
    const [wsSnap, selfSnap] = await Promise.all([
      db.doc(`shop_shops/${ctx.shopId}`).get(),
      db.doc(`shop_shops/${ctx.shopId}/ai_profile/self`).get(),
    ]);
    wsData = wsSnap.exists ? (wsSnap.data() as Record<string, unknown>) : null;
    selfData = (selfSnap.exists ? selfSnap.data() : null) as SelfBaseStyleDoc | null;
  } else {
    // personal: shop に紐づかない個人ユーザー。selfStyle のみ持つ。
    const selfSnap = await db.doc(pathAiProfile(ctx)).get();
    selfData = (selfSnap.exists ? selfSnap.data() : null) as SelfBaseStyleDoc | null;
  }

  const storeType = resolveStoreHintKey(wsData?.storeTypeName as string | undefined)
    || (wsData?.storeType as StoreType)
    || null;
  const storeProfile: StoreProfileDoc | null = wsData ? {
    name: wsData.name as string | undefined,
    type: wsData.type as 'personal' | 'business' | undefined,
    storeTypeName: wsData.storeTypeName as string | undefined,
    storeType: wsData.storeType as string | undefined,
    address: wsData.address as string | undefined,
    phoneNumber: wsData.phoneNumber as string | undefined,
    businessHours: wsData.businessHours as string | undefined,
  } : null;
  return { wsData, selfData, storeType, storeProfile };
}

// 最終的なプレイブック + selfBase + 店舗プロファイル を含む system instruction 拡張ブロックを作る
export function composePlaybookAndSelf(params: {
  storeType: StoreType | null;
  scene?: string | null;
  compact?: boolean;
  selfData: SelfBaseStyleDoc | null;
  selfHeading?: string;
  storeProfile?: StoreProfileDoc | null;
}): { playbookBlock: string; selfBlock: string; storeBlock: string; combined: string } {
  const playbookBlock = buildPlaybookInstruction({
    storeType: params.storeType,
    scene: params.scene ?? null,
    compact: params.compact ?? false,
  });
  const selfBlock = buildSelfBaseBlock(params.selfData, params.selfHeading);
  const storeBlock = buildStoreProfileBlock(params.storeProfile);
  return {
    playbookBlock,
    selfBlock,
    storeBlock,
    // STRICT_RULES_BLOCK を先頭に置くことで、後続のプロファイル/playbook より
    // 上位の優先度で「一人称・関西弁・捏造」のガードを効かせる
    combined: `${STRICT_RULES_BLOCK}\n\n${playbookBlock}${storeBlock}${selfBlock}`,
  };
}
