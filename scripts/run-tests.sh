#!/usr/bin/env bash
# `npm test` の実体（P155）。vitest を走らせ、**走り切ったか**まで判定する。
#
# ⚠️ ここが入口。別コマンドにすると打たれずに素通りするので、`package.json` の
#    `"test"` から直接呼ぶ（yorulog が `mac-test.sh` を直したのに主戦場が素通しだった実例）。
# ⚠️ **vitest の終了コードは `${PIPESTATUS[0]}` で拾う。** `| tee` 越しの `$?` は tee のもので、
#    **テストが落ちても 0 になる**（P154-PM6 で実際に踏んだ）。
set -u

LOG="${NOXA_TEST_LOG:-.test-output.log}"
# 実測 148 ファイル / 1935 件。下限は十分低く取る（増減で壊れないように。0 でないことが主目的）
MIN_FILES="${NOXA_MIN_TEST_FILES:-120}"
MIN_TESTS="${NOXA_MIN_TESTS:-1700}"

vitest run "$@" 2>&1 | tee "$LOG"
status=${PIPESTATUS[0]}

bash "$(dirname "$0")/check-test-output.sh" "$LOG" "$status" "$MIN_FILES" "$MIN_TESTS"
