// AI 機能の設定値を集約。ハードコードを減らし、チューニングを 1 箇所で済ます。
export const AI_CONFIG = {
  // チャット履歴
  maxHistoryMessages: 20,        // Gemini に渡す会話履歴の上限
  fullDataThreshold: 50,         // 顧客全件送信 or サマリ分岐のしきい値
  persistedChatLimit: 100,       // Firestore 永続化の上限

  // 画像・ファイル
  maxImageSizeBytes: 5 * 1024 * 1024, // 5MB
  maxImagesForAnalyze: 5,
  maxImagesForReply: 3,
  maxImagesForChat: 5,

  // グローバル成功パターン
  globalPatternLimit: 3,         // 注入する成功パターンの件数
  globalPatternMinSamples: 10,   // 集計ヒント表示の最小サンプル数

  // 過去フィードバック
  recentFeedbackLimit: 8,        // 参照する直近 👍👎 件数
  feedbackShowSlice: 3,          // プロンプトに載せる件数
} as const;
