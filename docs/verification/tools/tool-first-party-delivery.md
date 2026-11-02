# Tool first-party delivery — 実装検証記録（Issue #825 / ADR-0020）

- 対象: `refactor(tools): Tool を sandbox 付き iframe から first-party 同一 origin 配信へ変える`
- ADR: [`docs/adr/ADR-0020-tool-first-party-same-origin-delivery.md`](../../adr/ADR-0020-tool-first-party-same-origin-delivery.md)
- 実装仕様: [`docs/tools/tool-first-party-delivery-implementation-spec.md`](../../tools/tool-first-party-delivery-implementation-spec.md)
- 記録者: agent（Claude Code）
- owner confirmation: **unconfirmed**（この記録は agent が測った事実のみ。owner の承認ではない）

## 1. 契約（この記録が固定するもの）

`same_origin_static` の Tool は host の同一 origin で配信され、iframe は
layout / URL / CSS-DOM の器であって security boundary ではない。したがって
manifest の `delivery.iframe` は `sandbox` を宣言しない。`external_exception`
だけが sandbox を宣言し、`allow-same-origin` は引き続き常時拒否される。

違反コードは `embed.sandbox.not-allowed-for-first-party`。空文字
（`sandbox: ""`）も「sandbox なし」ではなく全制限の sandbox なので拒否する。

## 2. 測定値

すべてこの worktree（branch `825`、base `origin/release-0-8-1`）で実行した。

| # | 項目 | コマンド / 出所 | 実測値 |
| --- | --- | --- | --- |
| 1 | shipped manifest の `sandbox` 宣言数 | `grep -o '"sandbox"' src/tools/manifest.json \| wc -l` | **0** |
| 2 | manifest 検証 | `pnpm run tools:check` | `15 tools, ok. Delivery breakdown: {"same_origin_static":15}` |
| 3 | negative control（fail closed） | readmark に一時的に `"sandbox": "allow-scripts"` を足し `node scripts/check-tools-manifest.mjs --manifest=…` | exit **1**、`embed.sandbox.not-allowed-for-first-party: readmark: delivery.iframe.sandbox must not be declared for same_origin_static; a first-party Tool is served without a sandbox (ADR-0020)` |
| 4 | 描画 iframe（shipped Tool） | `pnpm exec vitest run test/integration/lazy-media-contract.test.ts` が SSR 出力から抽出 | `<iframe title="readmark Tool" src="/tools/readmark/app/index.html" referrerPolicy="no-referrer" style="…">` — **`sandbox=` なし** |
| 5 | embed policy の全件 verdict | `pnpm run tools:embed-policy:report -- --out=.tmp/tool-iframe-sandbox-825.html` | `15 entries, 15/15 embeddable entries policy-clean, 1 accepted / 7 rejected message fixtures` |
| 6 | セキュリティヘッダ契約 | `pnpm run security:headers:check` | ok。`Tool grants: pi-game -> fullscreen; mic-level -> microphone` |
| 7 | unit / integration（対象） | `pnpm exec vitest run src/tools/embed-policy.test.ts src/tools/registry.test.ts test/integration/lazy-media-contract.test.ts` | **103 passed**（embed-policy + registry）、**8 passed / 1 skipped**（lazy-media） |
| 8 | script tests（対象） | `node --test scripts/check-tools-manifest.test.mjs scripts/check-security-headers.test.mjs scripts/rewrite-asset-paths.test.mjs scripts/check-usable-product-preview-parity.test.mjs` | **83 passed / 0 failed** |
| 9 | 変更ファイルの format / lint | `pnpm exec biome check <git diff --name-only>` | `Checked 34 files … No fixes applied` |
| 10 | fast gate | `/Users/rebui/work/my-web-2026/.tmp/supervisor/bin/vfast` | `validate:fast OK — 67 declared step(s)` / `validate exit=0` |
| 11 | 実ブラウザ: readmark | `vite preview`（`http://127.0.0.1:4186`）+ Playwright Chromium（`.tmp/probe-825.mjs`） | iframe に `sandbox` 属性なし。frame の `window.origin` = host origin（`http://127.0.0.1:4186`）。frame 内で `indexedDB.open()` = ok、`localStorage.setItem()` = ok。SecurityError / CORS error 0 件。readmark は空ライブラリ状態（「まだ文書がありません」「PDF を import」）を描画 |
| 12 | 実ブラウザ: ProtoType 同意導線 | 同 preview + `.tmp/probe-825-proto.mjs` | 同意前: 「読み込みを開始する」ボタン 1 / iframe 0。クリック後: iframe 1 / ボタン 0。描画された iframe に `sandbox` 属性なし、`referrerpolicy="no-referrer"` |
| 13 | third-party origin 宣言 | `src/tools/manifest.json` | prototype の `third_party_origins` 4 件（fonts.googleapis.com / fonts.gstatic.com / script.google.com / use.typekit.net）は変更なし |

Issue #825 の受け入れ条件は「`/tools/readmark` が『ライブラリは空です』まで到達」と
書いているが、この worktree の readmark は空ライブラリを
「まだ文書がありません / PDF を import」と表示する。文言は一致しないが、
空ライブラリ状態に到達していることを本文で確認した。

preview は `vite build` → `build-tools.mjs` の後、`dist/client/tools/**` を
preview の assets snapshot（`.cloudflare/output/v0/workers/default/assets/`）へ
配置して起動した。`.cloudflare/**` はビルド成果物（git 管理外）であり、
リポジトリの追跡ファイルは変更していない。

### 2.1 新しい契約を固定しているテスト

- `src/tools/embed-policy.test.ts`
  - `every served Tool is first-party: no sandbox, and the referrer policy is declared`
  - `a sandbox on a first-party Tool is a violation, not a weaker declaration`
    （`allow-scripts` と `""` の両方）
  - `Tool embed policy — message origin by delivery kind`（first-party の
    `'self'` は一致し、external の opaque `"null"` は拒否）
  - sandbox token grammar は `external_exception` fixture に対してのみ実行
- `scripts/check-tools-manifest.test.mjs`
  - `fails the build for ANY sandbox on a first-party entry (ADR-0020)`
- `test/integration/lazy-media-contract.test.ts`
  - 描画 HTML に `sandbox=` がなく、`referrerPolicy="no-referrer"` を持つ
- `src/tools/registry.test.ts`
  - `ProtoType summary flattens delivery.iframe without a sandbox (ADR-0020)`

## 3. 測っていないこと（未測定）

以下はこの記録では測っていない。成功として扱わない。

- before-after 比較（旧 sandbox 構成との差分）。§2 #11 / #12 は現在の
  構成の実測であり、sandbox 付きだった過去リビジョンとの A/B は取っていない。
- `/tools/prototype` の activation 前後の third-party 要求**数**の再測
  （同意導線の表示 / iframe 生成は §2 #12 で確認済み）。
- `e2e/tools-prototype.spec.ts` に追加した frame origin assertion の実行
  （Playwright は `validate:fast` の対象外）。
- `pnpm run validate:integration`（build / bundle budget / wrangler dry-run /
  Storybook）。`validate:fast` は §2 #10 で測定済み。
- production（`https://rebuildup.dev`）への反映確認。
- 画面証跡（WebP）。この記録には画像を添付していない。

## 4. 変更点の要約

- manifest: 15 Tool すべてから `sandbox` を削除。sandbox だけを理由に
  宣言されていた `allow` / `sandbox_rationale` を削除し、`fullscreen`
  （`pi-game`）と `microphone`（`mic-level`）は Permissions-Policy /
  container の委譲として残した。
- `src/tools/embed-policy.ts`: first-party の `sandbox` を任意の文字列で拒否。
  sandbox token grammar は external 専用。
- `src/tools/manifest.schema.json` / `scripts/check-tools-manifest.mjs`:
  同じ契約を build gate と schema に反映。
- `src/routes/tools.$slug.tsx`: first-party では `sandbox` 属性を描画しない
  （`undefined` は React が属性ごと省略する）。`referrerPolicy` と `allow`
  は従来どおり描画する。
- third-party origin の同意経路（`embed-privacy.ts` / `click_to_load`）と
  `host_disabled` の「iframe も artefact も描画しない」規則は変更していない。

## 5. 公開日本語コピーの変更

`src/routes/tools.$slug.tsx` の blocked placeholder から `sandbox` を外した
（事実訂正）。copy approval gate に対しては **NEEDS REVIEW** として扱う。

旧: 「この Tool はホストの埋め込みポリシー（sandbox / referrerPolicy /
origin 契約）または第三者通信の契約に違反するため、iframe は描画されません。」

新: 「この Tool はホストの埋め込みポリシー（referrerPolicy / origin 契約）
または第三者通信の契約に違反するため、iframe は描画されません。」
