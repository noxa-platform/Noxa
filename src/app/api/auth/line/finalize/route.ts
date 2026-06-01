import { NextRequest, NextResponse } from 'next/server';

const LINE_TOKEN_COOKIE = 'yl_line_token';

/**
 * LINE Login コールバック後、httpOnly cookie に格納した Custom Token を
 * 一度だけクライアントに返却するエンドポイント。
 *
 * 旧実装は Custom Token を URL query (?lineToken=xxx) で渡しており、
 * ブラウザ履歴・サーバーログ・Referer ヘッダ経由で漏洩するリスクがあった。
 * 現実装は httpOnly cookie 経由で渡し、ここで一度だけ取り出して即削除する。
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(LINE_TOKEN_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ error: 'no_token' }, { status: 404 });
  }

  // 一度だけ使えるよう即削除
  const response = NextResponse.json({ token });
  response.cookies.set(LINE_TOKEN_COOKIE, '', {
    path: '/',
    maxAge: 0,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
  return response;
}
