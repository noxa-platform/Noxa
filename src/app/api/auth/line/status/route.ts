import { NextResponse } from 'next/server';

/**
 * LINE Login が本番で設定済みかをクライアントから確認するための軽量エンドポイント。
 * 機微情報は返さない（true/false のみ）。ログインボタンを条件表示するために使う。
 */
export async function GET() {
  const configured = Boolean(
    process.env.LINE_LOGIN_CHANNEL_ID && process.env.LINE_LOGIN_CHANNEL_SECRET,
  );
  return NextResponse.json({ configured });
}
