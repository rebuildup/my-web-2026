# ログ redaction 契約 (#467)

> 監査ログ・計測・API error・Auth・Infisical の各 stream に、token /
> Authorization / cookie / 個人情報が到達しないことを保証する契約と、
> その検査 (監査) の手順。

## なぜログを「公開面」として扱うのか

Worker の log stream は複数人が読む。運用者が `wrangler tail` で確認し、
vendor dashboard が複製し、Issue に貼られる。つまり **ログに書いた値は
公開したのと同じ**。

ログに到達しうる値:

- `Authorization` / `Cookie` ヘッダ (API key, session token, actor id)
- upstream が 5xx で返す本文 (リクエストを echo する reverse proxy を含む)
- Better Auth の email payload (宛先 = 個人情報、本文 = 単発リンクの token)
- GA4 の page_view payload (URL の query = token / email / 検索語)
- operator script の status 出力 (値は出さない|NAME は出す)

## 構造: `src/logging/` (leaf obligation)

```text
src/logging/redact.ts   値を書いてもよいか の判定 (3 層)
src/logging/logger.ts   src/** で console に触れてよい唯一の module
```

`redact.ts` の 3 層:

1. **key 名** — `authorization` / `cookie` / `*token*` / `*secret*` /
   `api_key` / `session_id` / `actor_id` / `email` / `user_agent` などの
   property は値ごと `[redacted]`。camelCase は snake_case に正規化してから
   判定 (`refreshToken` を捕捉するため)。
2. **値の形** — Bearer / Basic / JWT / 既知の key prefix (`mk_`, `sk-`,
   `ghp_`, `AKIA`, `AIza`, …) / `?token=` 等の query secret /
   `Cookie:` ヘッダ / email / 24 文字以上の不透明 blob を置換。
3. **構造** — depth / array 件数 / object key 数 / 文字列長の上限、
   循環参照の検出、class instance (`Headers` など getter を持つ型) は
   歩かない。`Error` は `{ name, message }` に畳み、stack は落とす。

redaction は **lossy** が既定。安全と判定できない値は置換する。
_call site_ がより多く-carry する必要がある場合は、生 payload ではなく
目的特化の最小 record をログする (実装例: `describeAuthEmail`)。

## gate: `pnpm run log:redaction:check`

`scripts/check-log-redaction.mjs`。`validate:fast` に含まれる。

1. **runtime console** — `src/**` が `src/logging/**` 以外で
   `console.*` を呼ぶと失敗。redaction を迂回できない。
   (`*.test.*` / `*.stories.*` は「console 出力を assert する」ことが
   目的なので除外)
2. **operator output** — `scripts/**` の `console.*` /
   `process.stdout.write` / `process.stderr.write` が secret 名の
   **値**を評価すると失敗。メッセージ中に secret の**名前**を書くのは
   status-only 契約として許可 (`REQUIRED_RUNTIME_SECRETS` の出力など)。
   例外は `ALLOWED_SECRET_VALUE_PRINTS` に理由を添えて 1 件だけ登録。

## 検査 (監査) の再現手順

```bash
pnpm run log:redaction:check                                  # 静的 gate
node --test scripts/check-log-redaction.test.mjs              # gate 自体の fixture
pnpm exec vitest run src/logging src/cloudflare/auth/better-auth.test.ts \
  src/editorial/analytics/GoogleAnalytics.test.tsx \
  test/integration/log-redaction.test.ts                      # runtime 面
node --test scripts/infisical-verify.test.mjs                 # Infisical 面 (stub CLI)
node scripts/log-redaction-report.mjs                         # 検証レポート生成 → .tmp/
```

検証レポート (`node scripts/log-redaction-report.mjs`) は
`docs/verification/security/log-redaction-test.webp` の元になる HTML で、
「after」列は `src/logging/redact.ts` を**実行して**得た値。canary が 1 件
でも残ればコマンドは非ゼロ終了し、スクリーンショットは作られない。

## 検査対象 (カバレッジ matrix)

| ログ面 | 入口 | 注入する疑似入力 | 主張 | 証跡 |
| --- | --- | --- | --- | --- |
| API error | `src/http/hono.ts` / `src/home/{access,reactions}/load.ts` | canary Authorization / cookie / `?token=`、upstream 502 が request を echo | response body と console のどちらにも canary なし。loader は縮小結果を返す | `test/integration/log-redaction.test.ts` |
| Auth | `src/cloudflare/auth/better-auth.ts` (`sendEmail`) | 宛先 address + `?token=` を含む本文 | `to: [redacted-email]` / `hasBody` / `bodyLength` のみ | `src/cloudflare/auth/better-auth.test.ts` |
| Infisical | `scripts/infisical-verify.mjs` ほか | stdout と stderr に canary を吐く stub CLI | driver の出力は status 行のみ | `scripts/infisical-verify.test.mjs` |
| Analytics | `src/editorial/analytics/GoogleAnalytics.tsx` | `?token=…&email=…` 付き location key | `page_path` / `page_location` は pathname のみ | `src/editorial/analytics/GoogleAnalytics.test.tsx` |

すべての test は**合成した canary** を使い、local fixture / workerd pool /
stub adapter の外へ出ない。本番 D1 / R2 / Infisical / Cloudflare API を
触る操作は含まない。

## 失敗時の挙動

- gate 違反 → `validate:fast` が非ゼロ終了 (build 失敗)。redaction を
 迂回する log call は追加できない。
- redaction が canary を残す → 対応する test が失敗し、レポート生成も
  非ゼロ終了する。fail-closed: 詳細(Log そのもの)を晒すより
  「到达しないこと」を保証する。
- upstream が落ちた場合、loader は例外を投げず契約どおりの縮小結果
  (`upstream_error` / `enabled: false`) を返す。ログは redacted な
  1 行だけで、throw して詳細を leak させることもない。
- 前提のない外部機能 (Infisical CLI など) は、**独立した stub / adapter
  として**検査を完成させる。安全性保証を飛ばした公開経路は作らない
  (Issue #467 受け入れ条件 3)。

## Known limits

- **初期 page_view**: `gtag('config', …)` による最初の page_view は
  GA 自身が `document.location` を読むため、本リポジトリのコードでは
  query を落とせない。`stripAnalyticsQuery` が効くのは SPA 遷移の
  page_view (`gtag('event', 'page_view', …)`) 側。解決には
  `__root.tsx` から pathname を `GoogleAnalytics` に渡して config に
  `page_path` を override する変更が要り、#286 の「config が最初の
  page_view をちょうど 1 回記録する」契約の再判断になるため本 Issue の
  範囲外。`/admin/invitations/accept?token=…` は pathname gate で
  admin 扱いになるため現状 GA には乗らない。
- **gate の静的解析は限定**: operator script 側は「secret 名の値を読む
  表現」を検出する静的ルールであり、値が別名 (`const v = secret`) に
  入った場合は検出しない。実行時の保証は marker ベースの
  `node --test` (stub / fake 入力) が担う。
- **`src/logging/redact.ts` の over-redaction**: 24 文字以上の不透明な
  token 風文字列 (UUID を含む) は `[redacted-blob]` になる。debug 上の
  可読性より漏えいを優先した意図的な選択。
