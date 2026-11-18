# 公開内部識別子 baseline 個別分類（2026-11-18）

`quality/public-internal-identifier-baseline.json` の 125 entry を、
公開到達性の実測に基づいて分類した記録。検出器
（`scripts/check-public-internal-identifiers.mjs`）は surface 宣言
ファイル内の文字列リテラルを走査するため、**非描画フィールドと
描画 copy を区別しない**。本書は entry 単位の結論を残し、baseline を
「説明のない検出例外」にしないための正本とする。

検証に使った実測:

- `test/integration/public-internal-identifier-surface.test.ts`
  （PR #1013）— 全公開 SSR route の実 Worker HTML（`$_TSR` payload
  埋め込み済み）+ 公開 `/api/v1/*` JSON を同一ルールで走査
- `pnpm build:cf:production` + `verify-cf-build-output` の client
  chunk marker 走査（PR #1014）— client bundle に operator data が
  到達しないことを artifact レベルで検査

## 分類の定義

| 分類 | 意味 |
| --- | --- |
| `non-rendered-field` | 描画経路が存在しないフィールド（evidence / note / schema メタ） |
| `operator-metadata` | operator 専用メタデータ。公開投影（`toSummary` 等）で除去済み |
| `internal-error` | throw される検証エラー等、訪問者に描画されない内部メッセージ |
| `detector-artifact` | コメント・外部 URL・テスト fixture 等、検出器の誤検出 |
| `intentional-public` | 意図的な技術説明として公開する copy（owner 例外確認待ち） |
| `fixed` | 実際に公開到達していたもの。PR #1012 / #1013 / #1014 で修正済み |

## 分類結果（125 entry）

### `src/tools/manifest.json` — 47 entry → `operator-metadata`

`source.canonical_repo` / `submodule_path` / `pinned_sha`、
`build.*`、`delivery.*`、`notes`、`privacy.basis`、Issue/PR 参照。
`src/tools/registry.ts#toSummary()` → `src/tools/public.ts` が
公開投影の deny-by-default 境界で、これらは `PublicToolSummary` に
含まれない。PR #1013 の SSR payload gate と PR #1014 の client
chunk marker 走査で、manifest internals が `$_TSR`・client bundle
に到達しないことを実測確認済み。**baseline 維持が正当** — 検出器が
「ファイル内の文字列」を見る以上、operator metadata の存在自体は
検出されるが、公開経路は構造的に断たれている。

### `src/privacy/data-lifecycle.ts` — 37 entry → `non-rendered-field`（大半）+ `detector-artifact`（一部）

- `evidence` 配列のリポジトリパス・Issue 参照・sync script 名、
  `publication.note` 内の Issue/PR 参照・docs パス: **非描画
  フィールド**。`privacy-notice.tsx` は label / stores / retention /
  deletion / transfer / senders / visibility のみ描画する。
- PR #1014 で `PublicDataLifecycleEntry` 投影 + serverFn 化により、
  registry 全体（pending entry・evidence 含む）が client bundle に
  入らない構造に変更。SSR payload からも `evidence` は除去済み
  （PR #1013 の `toPublicRecord` とは別経路 — こちらは
  `getPublishedPublicDataLifecycle` が投影時に落とす）。
- `Issue #316` / `#320` / `#936` 等は `publication.note` または
  evidence 内の参照で、公開 wording ではない。

### `src/tools/manifest.schema.json` — 16 entry → `operator-metadata`

manifest の JSON Schema。field 名（`disabled_reason` 等）と docs
パスを含むが、スキーマ自体は検証用で公開投影に含まれない。
`check-tools-manifest.mjs` が消費する内部契約。

### `src/contact/channels.json` — 6 entry → `non-rendered-field`

- `verified_at`（field-name）: Zod schema のフィールド名。PR #1013 で
  loader は `PublicContactChannel` 投影のみ返すため `$_TSR` に
  シリアライズされない。PR #1014 で schema 自体も client bundle から
  除去（`labels.ts` 分離）。
- `Issue #103` / `#832`、`docs/personal/*`、`docs/verification/*`:
  `$comment` / `$note` メタデータ。Zod の `ChannelsFileSchema` は
  未定義キーを strip するため Channel オブジェクトに残らず、
  `$`-prefix フィールドはそもそもスキーマに存在しない。

### `src/contact/schema.ts` — 1 entry → `internal-error`

`verified_at must be YYYY-MM-DD` — Zod のバリデーションメッセージ。
channels.json が不正な場合に module 評価時に throw される内部
エラーで、訪問者向け copy ではない。

### `src/editorial/error-states/contract.ts` — 2 entry → `non-rendered-field`

- `docs/domain/integrations.md`（ERROR_STATE_WITHHELD_INFO の
  ポリシー記述内）: withheld 情報リストの根拠説明文字列。テストと
  validator が消費する契約データで、エラー画面の copy ではない。
- `src/editorial/analytics/GoogleAnalytics.tsx`（同上リスト内）:
  同じくポリシー記述。
- `evidence:` フィールド（統合一覧データ内）: 内部 provenance。

### `src/editorial/structured-data/validate.ts` — 1 entry → `detector-artifact`

`docs/appearance/structured-data/search-gallery` は
`https://developers.google.com/search/docs/appearance/...` という
**外部 URL のパス成分**。repo-path ルールが URL 内の `docs/` を
誤検出したもの。 validator の `reference` フィールド値で、
リポジトリ内部パスではない。

### `src/home/current/providers.ts` — 1 entry → `non-rendered-field`（修正済み経路あり）

`scripts/sync-home-git-facts.mjs` — `ProjectFact#evidence` の値。
PR #1013 で `toPublicRecord` が `$_TSR` payload から strip。
PR #1014 で `getCurrentProjects` の dynamic import により
client bundle にも入らない。ソース文字列自体は server-side
モジュール内に残るが、公開成果物への到達経路は断たれている。

### `src/home/presence/fixtures.ts` — 1 entry → `detector-artifact`

`src/home/presence/types.ts` — Discord presence のテスト fixture
（`reader.test.ts` のみが import）。本番バンドル・公開経路に
到達しないテストデータ。copy surface の glob（`src/home/**`）が
テスト用ファイルも拾う構造的な過剰検出。

### `src/legal/contract.ts` — 1 entry → `internal-error`

`quality/asset-license-publication-decision.json` — 資産ライセンス
レビューの `finding()` 診断メッセージ内。operator 向けレビュー
記録の remediation 指示で、公開ページの copy ではない
（legal obligation は editoria primitives でレビューを描画するが、
この finding は operator の判断材料）。

### `src/portfolio/schema.ts` — 1 entry → `detector-artifact`

`scripts/check-i18n-policy.mjs` — 行末 `//` コメント内の言及。
`isCommentLine` が行頭コメントのみを除外するため、コード行末の
コメントを検出した誤検出。文字列リテラルではない。

### `src/portfolio/seed.ts` — 6 entry → `intentional-public`（owner 例外確認待ち）

`src/cloudflare/` `src/editorial/` `src/home/` `src/http/`
`src/portfolio/` `test/build/wrangler` — seed プロジェクトの
`motivationMd` 等に含まれるリポジトリ構造の記述。**公開 portfolio
copy であり、当該サイト自身のアーキテクチャを説明する意図的な
技術説明**。Issue #837 O-8 が許容する「理由つき例外」の候補。
owner が公開説明として承認するか、文言を一般化するかの判断待ち。
漏洩ではない。

### `src/routes/__root.tsx` — 1 entry → `detector-artifact`

`src/editorial/semantic-tokens.ts` — JSX コメント `{/* ... */}` 内の
言及。`isCommentLine` が複数行 JSX コメントを認識しないための
誤検出。コメントは描画されない。

### `src/tools/artifact-inventory.ts` — 2 entry → `internal-error`

`quality/tool-artifact-inventory.json`、`src/tools/manifest.json` —
JSDoc コメント内の参照。コメントは copy ではないが、
`isCommentLine` が JSDoc ブロック内の行を個別に判定する際に
検出した誤検出（コメント行の判定が行単位のため、`*` 始まりでない
継続行を拾う）。

### `src/tools/embed-policy.ts` — 1 entry → `internal-error`

`Issue #465` — manifest 検証の throw メッセージ内
（`sandbox_rationale` 必須化の理由説明）。運用者向けエラーで、
訪問者に描画されない。

### `src/tools/embed-privacy.ts` — 1 entry → `internal-error`

`Issue #498` — 同上。`delivery.privacy` 必須化の throw メッセージ。

## 結論

- **実際に公開到達していたもの**: PR #1012（4 件）・PR #1013（2 件）・
  PR #1014（2 件の client bundle 経路）で全て修正済み。
- **技術的に公開不能と証明できるもの**: `non-rendered-field` 46 +
  `operator-metadata` 63 + `internal-error` 4 + `detector-artifact` 6
  = **119 entry**。公開投影・serverFn 境界・artifact marker 走査で
  到達経路が断たれていることを実測確認済み。
- **owner 承認が必要なもの**: `src/portfolio/seed.ts` の 6 entry
  （`intentional-public`）。119 + 6 = 125 で baseline 全件を網羅。

## 機械検証

entry 単位の分類は `quality/public-internal-identifier-triage.json`
に 1:1 で記録し、`test/integration/public-internal-identifier-
triage.test.ts` が baseline との全単射・既知クラス・rationale 非空・
`intentional-public` の file 限定を CI で検証する。分類漏れ・重複・
stale entry・件数不一致はこのテストで fail する。
- **owner 承認が必要なもの**: `src/portfolio/seed.ts` の 6 entry のみ
  （意図的技術説明として公開するか、一般化するか）。

baseline の 125 entry は「説明のない検出例外」ではなく、上記の
分類根拠に基づく pending-review 状態として維持する。owner が
seed.ts の 6 entry を例外承認すれば exceptions ledger へ移行し、
baseline から除去できる。検出器の誤検出（detector-artifact 6 件）
は分類で管理するが、コメント認識・外部 URL 判定の改善で
baseline 自体を縮小する余地は残る。

## 追補: 検出器精度改善（同日・別 PR）

`detector-artifact` と分類した 6 entry のうち 4 件は検出器側の
欠陥だったため、分類記録で済ませず検出器自体を修正した
（`scripts/check-public-internal-identifiers.mjs`）:

- `src/editorial/structured-data/validate.ts` — 外部 URL
  （`developers.google.com/search/docs/…`）内の `docs/` パスを
  repo-path と誤検出。`findIdentifiers` が `http(s)://…` span を
  走査前に除去するようになった。
- `src/portfolio/schema.ts` — 行末 `//` コメント内の script 名を
  検出。`isCommentLine` は行全体がコメントの場合しか除外しない
  ため、文字列・テンプレートを考慮した `stripJsComments` を
  `.ts/.tsx/.js/.jsx` に適用した。
- `src/routes/__root.tsx` — JSX コメント内の言及を検出。
  同上の block comment 追跡で解消。
- `src/home/presence/fixtures.ts` — `reader.test.ts` のみが import
  するテスト fixture が `src/home/**` glob に拾われていた。
  `copy-editorial-surfaces.json` の `excludeGlobs` に
  `fixtures.ts`（file 版）を追加した（根拠は
  `docs/runbook/copy-editorial-approval.md` §6.1.2）。

残る `src/tools/artifact-inventory.ts` の 2 entry は、JSDoc 内の
言及だけでなく throw message の文字列リテラルにも同一パスが
存在するため検出自体は正当 — 分類を `detector-artifact` から
`internal-error`（operator 向け診断メッセージ）へ修正した。

機械可読な対応表 `quality/public-internal-identifier-triage.json`
も同じ変更を反映し、baseline との bijection を保つ。

### 改善後の baseline（121 entry）

| 分類 | 件数 |
| --- | --- |
| `operator-metadata` | 63 |
| `non-rendered-field` | 46 |
| `internal-error` | 6 |
| `intentional-public`（owner 確認待ち） | 6 |
| `detector-artifact` | 0 |
| **計** | **121** |

非描画系（operator-metadata + non-rendered-field + internal-error）
は **115 entry**、seed.ts の意図的公開候補が **6 entry**。
baseline は `--update-baseline` で再生成済み。
