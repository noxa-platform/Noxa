// IAP 商品マスタの公開エンドポイント。
//
// iOS アプリは起動時に GET してローカルにキャッシュし、StoreKit から取得した
// localizedPrice と組み合わせて UI に表示する。認証不要（読み取り専用）。
import { NextResponse } from 'next/server';
import { IAP_PRODUCTS } from '@/lib/iap/products';

export async function GET() {
  return NextResponse.json({ products: IAP_PRODUCTS });
}
