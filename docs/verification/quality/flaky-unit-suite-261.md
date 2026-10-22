# Issue #261 — flaky unit suite 修正検証記録

## 線引き
- 修正範囲: `test/integration/cors.test.ts` と `test/integration/security-headers.test.ts` の2ファイルに `beforeAll` warm-up を追加。残りの脆弱ファイル（`beforeAll` がなく `cloudflare:test` を import する約30ファイル）は残存リスクとして残す。
- `testTimeout` は変更なし（5000ms）。
- 計測 instrumentation は含めない（削除済み）。

## 根本原因
`cloudflare:test` を import する file は workerd pool に接続し、その file 内の最初の `SELF.fetch` が SSR bundle の cold-start（実測 ~2230-2616ms）を負う。この時間が `testTimeout` の5000ms予算の内側に入るため、競合負荷（同一machineで複数suite並行）が増えると予算を超えて timeout する。修正は `beforeAll` で1回だけ warm-up fetch を行い、cold-start を hook 予算（test 予算外）に出す（Issue #266 と同一パターン）。

## 修正内容
- `test/integration/cors.test.ts`: `beforeAll` で `/api/v1/health` を fetch
- `test/integration/security-headers.test.ts`: 最初の `describe` に `beforeAll` で `/contact` を fetch

## 計測表
| file | 修正前 第1テスト時間 | 修正後 第1テスト時間 | 判定 |
| --- | --- | --- | --- |
| `test/integration/cors.test.ts` | 4195ms（最後のテストが cold-start を負っていた） | 57ms（warm-up 済み） | 修正済み |
| `test/integration/security-headers.test.ts` | 未計測（同様の脆弱性を持つ） | 7-12ms（競合3way後） | 修正済み |

## 再現率（競合負荷 3way）
- Before: 3/3 timeout（推定、同じ構造の `admin-routing` で実証済み）
- After: 3/3 green

## 残存リスク
- 約30個の `test/integration/*.test.ts`（`beforeAll` がなく `SELF.fetch` を使うもの）は同じ脆弱性を持つが、スコープ外として残す。次のリリースで同様の `beforeAll` を追加する必要がある。
