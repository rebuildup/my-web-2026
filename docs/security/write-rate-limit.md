# 書き込み系 rate limit の運用契約（Issue #456）

ADR-0010 が決めた「consumer principal ごとの Workers Rate Limiting
binding」という**方針**は変わらない。Issue #456 が追加するのは、その方針が
**本当にそう振る舞うことをローカルで測定する試験**と、抑制された応答の
**Retry 契約**、およびその運用上の向き合い方である。

対象は既に存在する外部 HTTP 境界の write endpoint のみ:

| Method | Path | Binding | 上限 | 期間 |
| --- | --- | --- | --- | --- |
| `PUT` | `/api/v1/reactions` | `RATE_LIMIT_WRITE` | 60 | 60 s |
| `DELETE` | `/api/v1/reactions` | `RATE_LIMIT_WRITE` | 60 | 60 s |
| `POST` | `/api/v1/access/hit` | `RATE_LIMIT_WRITE` | 60 | 60 s |
| `GET` | `/api/v1/reactions?target=` | `RATE_LIMIT_READ` | 600 | 60 s |
| `GET` | `/api/v1/access/count/:key` | `RATE_LIMIT_READ` | 600 | 60 s |
| `GET` | `/api/v1/reaction-images/:id` | `RATE_LIMIT_READ` | 600 | 60 s |

定義の実体は `scripts/_cloudflare-contract.mjs` の `RATE_LIMITS` /
`RATE_LIMIT_BINDING` / `RATE_LIMIT_NAMESPACES`、
binding の宣言は `cloudflare.config.ts` の `bindings.rateLimit()`。
ドキュメント・コード・テストはここを参照する（値の再記述はしない）。

## principal と「1 バケット」の意味

- principal は **API key id**（`requireApiKey` が `c.var.apiKey.id` に
  設定する値）。リクエスト IP ではない。
- したがって書き込みバケットは **principal ごとに 1 つ**であり、
  ルートごとではない。`PUT /api/v1/reactions` と
  `POST /api/v1/access/hit` は同じ 60 回を使い合う。reactions を
  連打すると counter の書き込みも同じ枠で弾かれる。
- API key を持たない経路（public な画像 GET）はリクエスト IP を
  principal として使う（ADR-0010 の既知の制限）。
- どちらの principal も無い場合は `'anonymous'` に落ちる。この経路は
  現状 `requireApiKey` の後ろにあるため到達しないが、middleware
  単体では明示的に監督している。

## ミドルウェアの順序と、その意味論

```text
requireApiKey  →  rateLimit{Write,Read}  →  handler (body validation → D1)
```

この順序から次の 2 つが契約になる（いずれも自動試験で固定している）。

1. **認証は予算を消費しない。** 401 / 403 は `limit()` を呼ばずに返る。
   したがって認証されていない連打は budget を消費せず、認証レイヤー
   が先に答えられる（429 ではなく 401）。
2. **body 検証は予算を消費する。** middleware は handler より前に
   走るため、上限に達している場合は不正な body であっても 429 が
   先に返る（400 より前）。レート制限は入口で動く制御であり、入力を
   種類別に別予算へ分ける設計は Middleware の責務ではない。必要に
   なったら ADR-0010 の改訂として扱う。

## 抑制された応答の契約（Issue #456 で追加）

```http
HTTP/1.1 429 Too Many Requests
retry-after: 60
content-type: application/json

{"error":"rate_limited"}
```

- **body** は変更していない。`{ error: 'rate_limited' }` は既に
  consumer（`src/home/reactions/load.ts` /
  `src/home/access/load.ts`）が分岐している機械可読契約。
- **`Retry-After`** を追加した。値は binding の fixed window
  （60 秒）。binding の `limit()` 結果はリセット時刻を返さないため、
  Worker 内から誠実に表明できるのは window 全体（= 待つなら必ず
  成功する最短時間）である。
  この値は `RATE_LIMIT_RETRY_AFTER_SECONDS`
  （`src/http/middleware/rate-limit.ts`）にあり、
  `RATE_LIMITS[…].period` と一致することを
  `src/http/middleware/rate-limit.test.ts` が検証する。
- 受理された応答には `Retry-After` を付けない（クライアントが
  「再試行すべき」と誤読しないため）。

### クライアント側の扱い

| 層 | 429 の扱い |
| --- | --- |
| `src/home/reactions/load.ts` | `{ ok: false, reason: 'rate_limited' }` |
| `src/home/access/load.ts` | `{ ok: false, reason: 'rate_limited' }` |
| `src/home/reactions/widget.tsx` | `describeMutationError('rate_limited')` で訪問者向け文言（待機して再試行）を表示。生の reason は `data-error-reason` に残す |

optimistic な chip state はロールバックしない（既存の UI 方針のまま）。
429 は「保存されなかった」ことだけを知らせ、次のページロードで
実状態に reconciliation される。

## 検証

```bash
# 実 HTTP リクエストを本地 worker（Miniflare の実 rate-limit binding）へ流す
pnpm exec vitest run test/integration/write-rate-limit.test.ts

# middleware 単体 + Retry 契約のドリフト防止
pnpm exec vitest run src/http/middleware/rate-limit.test.ts

# スクリーンショット（docs/verification/security/reactions-rate-limit.png）を再生成
pnpm run verification:write-rate-limit
```

ローカル試験が証明すること:

- 本番 `externalBoundary` に対する実リクエストで 60 回まで 200、
  61 回目が 429 `rate_limited` + `Retry-After: 60`。
- 100 リクエストの同時バーストが上限（60）で頭打ちになる。
- 抑制された write が D1 に到達しない（counter も reactions も増えない）。
- principal を跨いだ独立性、write 枯渇後の read budget 生存。
- 認証が throttle より先`、`limit()` を消費しないこと。

ローカル試験が**証明しない**こと（`docs/security.md` の
「local workerd vs real Cloudflare」節が同日旨）:

- 本番 edge に実在する Cloudflare Rate Limiting binding の挙動。
- edge 間一貫性（ Workers Rate Limiting は location-local）。
- namespace_id（`scripts/_cloudflare-contract.mjs` の placeholder）が
  本番 Worker の実値であること。

## スクリーンショット

`docs/verification/security/reactions-rate-limit.png` は
`test/integration/write-rate-limit.test.ts` が**実測して印字した**
matrix（成功 200 / 拒否 400・401・403 / 抑制 429 と `Retry-After` /
read budget の生存）を HTML 化して Playwright で撮影したものである。
生成スクリプトは `scripts/capture-write-rate-limit-report.mjs`。
credential らしき文字列を含む行は描画前に拒否する（描画しないまま
異常終了する）。API key は DI seam のスタブであり、実値は読まない。

## 変更時の運用影響

- **secret / rotation への影響はない。** rate-limit binding は secret
  ではなく、値を持たない Edge 側の名前付き binding。`BETTER_AUTH_*`、
  `MY_WEB_2026_CONSUMER_API_KEY`、Infisical の棚卸し・rotation
  runbook は変更しない。
- **binding の予算を変更する場合**は 3 箇所を同時に直す:
  `scripts/_cloudflare-contract.mjs` の `RATE_LIMITS`、
  `cloudflare.config.ts` の `bindings.rateLimit()`、
  `src/http/middleware/rate-limit.ts` の
  `RATE_LIMIT_RETRY_AFTER_SECONDS`（テストが 1 箇所目のドリフトを
  検出する）。`cf-typegen` は binding の型が変わらないため不要だが、
  `validate:release` は通すこと。
- **本質的な構成変更**（binding の増減、principal の変更、
  fixed → sliding）が必要になった場合は ADR-0010 の改訂として扱い、
  ここで運用契約を書き直す。

## 既知の制限（ADR-0010 から継承）

- Workers Rate Limiting は **edge location 単位**。1 consumer に
  対する実効予算は「1 _REQ/min × edge 数」の上限になり得る。
- principal は `(key id)` だけで `(key id, route)` に割っていない。
  route 単位の予算が必要なら binding の追加になる。
- fixed window なので、窓の境界をまたぐ短時間バーストは許される
  （60 + 60 が 2 秒内に通りうる）。60/分予算では許容範囲。
- per-visitor（訪問者単位）の制限は未着手。consumer backend が
  訪問者を識別できる場合は別 ADR の領域。