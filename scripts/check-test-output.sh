#!/usr/bin/env bash
# テスト出力が「走り切ったか」を判定する（P155）。
#
# ## なぜ要るか — 沈黙は 3 段ある（yorulog と整理）
#   ① 走査対象が空   … 指摘ゼロ＝緑        → 各ガードの「空振り防止」テストで拾う
#   ② 全部の沈黙     … 件数行が無い        → vitest は `No test files found` で非 0（実測）
#   ③ **部分的な沈黙** … 件数行はあるが少ない → ここが Web の穴だった（実測: 1 ファイルだけ
#      走らせると `Test Files 1 passed` で **status=0**）。設定やグロブが縮んで 148 → 40 に
#      なっても**満点の緑に見える**。防いでいたのは「引き継ぎメモの期待値と見比べる」
#      という**運用だけ**だった。
#
# ⚠️ **入口（`npm test`）から呼ぶこと。** 別コマンドにすると、打たなければ運用に戻る
#    （yorulog が `mac-test.sh` を直したのに主戦場の `swift test` が素通しだった実例）。
# ⚠️ **vitest の終了コードを殺さないこと。** パイプ越しの `$?` は `tail` のものになる（P154-PM6）。
#    呼び出し側は vitest の status を変数で持ち、この判定に引数で渡す。
#
# 使い方: check-test-output.sh <ログ> <vitest の終了コード> <ファイル数の下限> <件数の下限>
set -u

log="${1:?ログのパス}"; vitest_status="${2:?vitest の終了コード}"
min_files="${3:?ファイル数の下限}"; min_tests="${4:?件数の下限}"

if [ ! -s "$log" ]; then
  echo "❌ テスト出力が空です（実行そのものが始まっていません）" >&2
  exit 1
fi

# 「Test Files  148 passed (148)」「Tests  1935 passed (1935)」の括弧内＝**総数**を取る。
# ⚠️ `passed` の数ではなく総数を見る。失敗があっても走り切ったかは別の話なので分けて判定する。
files=$(grep -oE '^[[:space:]]*Test Files[[:space:]]+.*\(([0-9]+)\)' "$log" | tail -1 | grep -oE '\(([0-9]+)\)$' | tr -d '()')
tests=$(grep -oE '^[[:space:]]*Tests[[:space:]]+.*\(([0-9]+)\)' "$log" | tail -1 | grep -oE '\(([0-9]+)\)$' | tr -d '()')

if [ -z "${files:-}" ] || [ -z "${tests:-}" ]; then
  echo "❌ 件数行がありません（②全部の沈黙）。残りは落ちたのではなく**走っていません**" >&2
  exit 1
fi

if [ "$files" -lt "$min_files" ] || [ "$tests" -lt "$min_tests" ]; then
  echo "❌ ${files} ファイル / ${tests} 件しか走っていません（下限 ${min_files} / ${min_tests}）" >&2
  echo "   ③部分的な沈黙。走らなかったぶんは**落ちなかったのではなく、走っていません**" >&2
  exit 1
fi

if [ "$vitest_status" -ne 0 ]; then
  echo "❌ ${files} ファイル / ${tests} 件を実行、テストに失敗あり（終了コード ${vitest_status}）" >&2
  exit "$vitest_status"
fi

echo "✅ ${files} ファイル / ${tests} 件を実行して全緑（下限 ${min_files} / ${min_tests}）"
