# Issue #825 実装 spec — first-party 同一 origin の Tool 配信（pi worker handoff）

- 対象: Issue #825 `refactor(tools): Tool を sandbox 付き iframe から first-party 同一 origin 配信へ変える`
- branch: `825`（`release-0-8-1` から作成済み。base commit `4778028c`）
- 決定: [ADR-0020](../adr/ADR-0020-tool-first-party-same-origin-delivery.md) を参照
  （方向性は owner 承認済み、本文は PR review 待ち）
- この文書は実装の指示であり、決定ではない。判断に迷ったら ADR-0020 と Issue #825 の
  受け入れ条件に戻る。

---

## 0. 決定の要約

| # | 決定 |
| --- | --- |
| D1 | `same_origin_static` の Tool は **sandbox なし**で host と同じ origin から配信する。`delivery.iframe.sandbox` は宣言できない。 |
| D2 | iframe は**残す**。ただし「レイアウト / URL の器」であり、security boundary ではない。direct 配信はこの ticket では行わない（§2）。 |
| D3 | `external_exception` は sandbox の規則を**そのまま残す**（live 0 件）。`host_disabled` の休眠 `iframe` 宣言は `referrer_policy` と `allow` だけを持ち、`sandbox` を持たない。 |
| D4 | 残す規則: `referrer_policy` / frame origin / third-party origin 宣言と consent / `host_message` / `Permissions-Policy` / `frame-ancestors 'self'`。 |
| D5 | 消す規則: first-party の sandbox token 解析、`sandbox_rationale`（first-party）。`host_message` の「すべての frame は opaque origin」という注記は first-party について削除する。 |

**絶対にやらないこと（ADR §1.5）**: `allow-same-origin` を足して解決しない。
同一 origin の成果物に `allow-same-origin` を付けるのは「sandbox を外す」と
ブラウザ権限はほぼ同じで、属性が残るぶん review を誤読させる。既存 policy が
明示的に禁止している規則を復活させない。

## 0.1 Release 前条件（ADR §3.6）と #598

- sandbox のない同一 origin の Tool script は、**parent DOM / 同一 origin の
  storage / 同一 origin の API に到達できる**前提で実装・review する。
- 未許可の 3rd-party / upstream を `same_origin_static` と宣言して実行しない。
- 有効化を伴う release は ADR §3.6 (a)–(h)（provenance、build review、
  共有 origin 権限の検査、CSP / Permissions-Policy の実測、クリック同意と
  外部通信）の証跡を `docs/verification/tools/` に残す。
- `external_exception` の sandbox 規則は壊さない。
- `mic-level`（#598）は `getUserMedia` を維持し、`host_disabled` のまま。
  休眠宣言から `sandbox` を外すだけで、有効化はしない。卒業は Tool 側 build /
  browser grant / frame origin の e2e を伴う別 ticket（ADR §4.5）。
- 旧選択肢 B（storage を使わない設計に寄せる）は却下済み。実装しない。

---

## 1. 前提の訂正（Issue 本文との差分）

Issue #825 の「全 Tool の `delivery.kind` は `same_origin_static`」は不正確。
2026-11-02 時点の実データ:

| slug | `delivery.kind` | `classification` | `iframe.sandbox` | 扱い |
| --- | --- | --- | --- | --- |
| `prototype` | `same_origin_static` | `same_origin_static` | `allow-scripts` | **削除** |
| `readmark` | `same_origin_static` | `same_origin_static` | `allow-scripts` | **削除** |
| `mic-level` | `host_disabled` | `external_exception` | `allow-scripts` + `allow: microphone` | **削除**（休眠宣言。`disabled_reason` の卒業先は `same_origin_static`） |
| その他 12 件 | `host_disabled` | `needs_tool_side_fix` | なし | 変更なし |

- 「sandbox を外す」対象は 3 entry。live な embeddable Tool は 2 件。
- `external_exception` の token 規則は**コードと schema に残す**。live 0 件だが、
  将来の foreign origin は sandbox が唯一の隔離だから。
- `mic-level` を external として卒業させる場合は、その時点で `sandbox` を
  宣言する（`host_disabled` の間は持たない）。

---

## 2. iframe は器として残す（direct 配信にしない）

### 2.1 測定（2026-11-02、production）

`.tmp/issue-825/probe.mjs` を `https://rebuildup.dev/tools/readmark` に対して
実行した結果:

| frame | document URL | `indexedDB.open()` | `localStorage` | 表示 |
| --- | --- | --- | --- | --- |
| top | `https://rebuildup.dev/tools/readmark` | ok | ok | host chrome + 同意 band |
| child | `https://rebuildup.dev/` | `SecurityError` | `SecurityError` | `... 読み込み中…` |

console: `Access to XMLHttpRequest at 'https://rebuildup.dev/cdn-cgi/rum?' from
origin 'null' ...`。`origin 'null'` が opaque origin の証拠。

### 2.2 なぜ iframe を残すか

1. **URL の封じ込め。** pinned readmark は `BrowserRouter` の `basename="/"` と
   `* → <Navigate to="/" replace/>` を持つ。iframe 内ではこの `replaceState` は
   frame の URL だけを書き換える（上の child URL が実測）。同じ bundle を
   `/tools/readmark` のトップレベル文書にすると、同じコードが**アドレスバーを
   `/` に書き換える**。host 側では直せない。Tool 側の relocatable base
   （Vite `base` + router `basename`）が入るまで、iframe が唯一の器。
2. **host chrome / scroll の分離。** `/tools/<slug>` は nav / footer / 同意 band を
   持ち、tool の領域だけが scroll する。direct 配信は別の product surface になる。
3. **CSS / DOM の封じ込め。** 別 document なので global CSS が漏れない。

したがって残す。ただし **`sandbox` 属性は描画しない**。iframe を
「security boundary」と書かない。`frame-ancestors 'self'` は inbound policy
として残す（sandbox とは別物）。

direct 配信は別の product 決定（chrome をどうするか、relocatable base をどう
契約するか）なので、この ticket では実装しない。

---

## 3. 変更ファイル

### 3.1 `src/tools/manifest.json`

`prototype` / `readmark` / `mic-level` の `delivery.iframe` から
`sandbox` を削除する。他は変えない。

`prototype` / `readmark`:

```jsonc
"iframe": {
  "referrer_policy": "no-referrer"
}
```

`mic-level`（ dormant 宣言。`allow` は残す）:

```jsonc
"iframe": {
  "referrer_policy": "no-referrer",
  "allow": "microphone"
}
```

`readmark.notes` の誤りも直す。現在の
「COOP/COEP headers required for SharedArrayBuffer pdfjs decode — ... headers are
deployable」は事実ではない（host は COOP/COEP を送っていない）。次の内容に
置き換える。

- sandbox は ADR-0020 / Issue #825 で廃止。frame は host と同一 origin。
- pinned `906c90e` は足場で、import ボタンは無効、reader はプレースホルダ。
  空 library まで到達するのが #825 の受け入れ範囲。
- upstream `main`（2026-11-02 時点 `6b2d404`）は IndexedDB 前提の完全実装。
  pin bump は別 ticket。
- `third_party_origins: []` は pinned build の実測。bump 後に再測定する。

`description_ja` / `description` は変えない（「ローカルファースト」は storage が
動くようになるので再び正しい）。

### 3.2 `src/tools/manifest.schema.json`

`delivery` は `oneOf` ではない（`kind` を持つ単一 object）。schema は editor 向けの
advisory で、実行時の authority は `embed-policy.ts` と
`scripts/check-tools-manifest.mjs`。したがって大規模な `oneOf` 再構成はしない。

変更:

1. `delivery.iframe.description` を更新:
   「referrer policy + capability grant + message contract。`sandbox` は
   `external_exception` だけが宣言できる。`same_origin_static` は first-party
   同一 origin であり sandbox を持たない（ADR-0020 / Issue #825）。」
2. `delivery.iframe.required` を `["sandbox", "referrer_policy"]` から
   `["referrer_policy"]` に変更。
3. `sandbox.description` の先頭に「`external_exception` 専用。`same_origin_static`
   と `host_disabled` では宣言できない（ADR-0020）。」を追加。既存の token
   一覧は external 用として残す。
4. `sandbox_rationale.description` に「`external_exception` 専用」を追加。
5. `allow.description` の「Required (non-empty) when the sandbox uses any
   conditional token」を「Required when an `external_exception` sandbox uses any
   conditional token」に変更。
6. `host_message.expected_origin.description` の CAVEAT を書き換える:
   - `same_origin_static`: `'self'` は host origin に解決され、frame の
     `event.origin` も host origin になる（sandbox がないため一致する）。
   - `external_exception`: 引き続き opaque origin（`"null"`）なので、literal な
     `https://…` は runtime で一致しない。これは external の制約として残す。

### 3.3 `src/tools/embed-policy.ts`

- ファイル冒頭の説明を書き直す。旧 rule 2「Same-origin artefact, sandboxed away
  from the host origin」を、次の 2 つに分ける:
  - first-party: sandbox なし。boundary は build / review（ADR-0020）。
  - external: sandbox 必須。token 規則は不変。
- 「Known limitation」段落を first-party / external に分割。first-party の
  opaque origin 制約は削除。external の制約だけ残す。
- `EmbedViolationCode` に
  `'embed.sandbox.not-allowed-for-first-party'` を追加。
- `evaluateIframeDeclaration(slug, subject)`:
  - `subject.kind === 'same_origin_static'` のとき:
    - `parseTokenList(iframe.sandbox).length > 0` なら新 code を 1 件追加。
    - token grammar の検査はしない（sandbox 自体が違反）。
  - それ以外（`external_exception`）は既存の sandbox block をそのまま実行。
  - `iframe` が無い場合の `embed.iframe.missing` は両 kind で維持
    （`referrer_policy` が必須のため）。
- `evaluateHostMessageDeclaration`:
  - first-party の「matching origin は sandbox により決して成立しない」NOTE を
    削除し、「first-party では `'self'` が host origin に解決され、runtime で
    一致する」と書く。
  - external には opaque origin の NOTE を残す。
- 公開型 `ToolIframeDeclaration` は `sandbox?: string` のまま
  （external と host_disabled の型で使う）。first-party の manifest 型だけ
  `sandbox` を持たない inline type にする（§3.4）。

### 3.4 `src/tools/registry.ts`

- `ManifestTool` の `same_origin_static` branch の `delivery.iframe` から
  `sandbox` と `sandbox_rationale` を削除する:
  ```ts
  readonly iframe?: {
    readonly referrer_policy: string;
    readonly allow?: string;
  };
  ```
- `external_exception` branch は現状維持（`sandbox` 必須、`sandbox_rationale?`）。
- `host_disabled` branch の `ToolIframeDeclaration` はそのままでよいが、
  コメントに「休眠宣言は `referrer_policy` と `allow` だけ。`sandbox` は
  卒業先が external のときだけ」と書く。
- `PublicToolSummary.iframe`:
  ```ts
  readonly iframe: {
    /** first-party は undefined（sandbox なし）。external だけが持つ。 */
    readonly sandbox?: string;
    readonly referrer_policy: string;
    readonly allow?: string;
  };
  ```
- `toSummary()` の既定値を `{ referrer_policy: '' }` に変更
  （`sandbox: ''` を捏造しない）。
- 冒頭コメントの「the iframe sandbox / referrer policy for the iframe route」を
  「the iframe referrer policy / capability grant, and the external sandbox when
  one applies」に変更。

### 3.5 `src/routes/tools.$slug.tsx`

- `ToolEmbedGate` / `ToolEmbedShell` の `sandbox` prop を
  `sandbox?: string | undefined` に変更。
- `<iframe sandbox={sandbox} ...>` はそのまま。`undefined` のとき React は
  属性を出力しない。**条件分岐で属性を消すコードを書かない**。
- コメント:
  - loader の「embeddable — satisfies every sandbox / referrer / origin rule」を
    「referrer / origin rule」に。
  - 「renders with the DECLARED `sandbox` + `referrerPolicy`」を
    「renders with the DECLARED `referrerPolicy`（first-party は sandbox なし、
    external だけが sandbox を持つ）」に。
  - `ToolEmbedShell` の「conditional sandbox token」「mic-level の
    `allow-same-origin`（Issue #598）」の段落を書き直す。same-origin の卒業には
    `allow-same-origin` が不要になったことを明記。
- blocked 文言（`src/routes/tools.$slug.tsx` の `BlockedPlaceholder`）:
  現在の日本語は「（sandbox / referrerPolicy / origin 契約）」。
  `sandbox` を外して次にする（**事実訂正。copy approval は PR で NEEDS REVIEW
  として記録する**）:
  ```
  この Tool はホストの埋め込みポリシー（referrerPolicy / origin 契約）または
  第三者通信の契約に違反するため、iframe は描画されません。
  ```
  英語は変更しない。

### 3.6 テストと fixture

| ファイル | 変更 |
| --- | --- |
| `src/tools/embed-policy.test.ts` | `okDelivery`（L48）を `iframe: { referrer_policy: 'no-referrer' }` に。sandbox token suite（L103–L240）は **external fixture**（`external_url: 'https://tool.example/app'`）に対して実行する。first-party 用に「`sandbox` があると `embed.sandbox.not-allowed-for-first-party`」「ないと違反 0」の 2 test を追加。`host_message` suite（L526–L560）を書き直し、same-origin + `'self'` が runtime で**一致する**ことを assert する。 |
| `src/tools/registry.test.ts` | L153 の `assert.equal(summary?.iframe.sandbox, 'allow-scripts')` を `assert.equal(summary?.iframe.sandbox, undefined)` に。L54 のコメント（sandbox-safe storage layer）を更新。 |
| `test/integration/lazy-media-contract.test.ts` | L219–L221 の `expect(iframes[0]).toContain('sandbox="allow-scripts"')` を `expect(iframes[0]).not.toContain('sandbox=')` に。コメントを「the frame is first-party; the shell is not sandboxed (ADR-0020)」に。 |
| `scripts/check-tools-manifest.test.mjs` | `okIframe`（L144, L266）を `{ referrer_policy: 'no-referrer' }` に。escape 系（L164–L166, L317–L319, L351）は external fixture に移す。first-party の `sandbox` 追加は新 code を期待。L187 / L328 の期待 code を更新。 |
| `scripts/make-tool-artifact-fixture.mjs` | L201 の fixture から `sandbox` を削除。 |
| `scripts/make-provenance-fixture.mjs` | L157 の fixture から `sandbox` を削除。 |
| `test/integration/cors.test.ts` L271 | label を `'opaque-origin request (Origin: null) on the auth route'` に、meaning を「an opaque origin (null) is never allow-listed; this case no longer describes the shipped first-party Tool frame」に。リクエスト自体は変更しない。 |
| `scripts/cors-preflight-report.mjs` L206 | 同じ label / meaning に。 |
| `e2e/tools-prototype.spec.ts` | 冒頭の「The iframe is sandboxed at allow-scripts only」と history note を更新。mount test に「`window.origin === new URL(page.url()).origin`」を追加（`page.frames()` から frame を取って `evaluate`）。 |
| `e2e/lazy-media.spec.ts` L641 | コメントを「The shell must still mount its Tool iframe」に。 |
| `e2e/tools-readmark.spec.ts`（新規） | §4.1 の acceptance をそのまま e2e にする。 |

**fixture の罠**: `embed-policy.test.ts` の sandbox suite を first-party fixture の
まま残すと、`sandbox` が「禁止」になり token の test がすべて新 code 1 件に
潰れる。必ず external fixture に移すこと。

### 3.7 ドキュメント

**必ず更新（現在の first-party frame を sandbox 付きと書いているもの）**

| ファイル | 変更 |
| --- | --- |
| `docs/tools/embed-policy.md` | タイトルと §1–§2 を「first-party は sandbox なし / external は sandbox あり」に再構成。§5a を first-party（`'self'` が成立）と external（opaque のまま）に分割。§2 の token table は external の節へ移す。 |
| `docs/tools/runbook.md` | L51–L62 の「For same_origin_static entries, the iframe sandbox does not contain allow-scripts allow-same-origin」を「same-origin entries must not declare a sandbox; external entries are checked by the token grammar」に。L75–L78 の説明も追随。 |
| `docs/security/security-headers.md` | §3 の measurement table は「external / allow-same-origin の測定」として残し、**現在の first-party frame は sandbox なし**と明記。§5 の「`mic-level` は allow-same-origin が必要」を「same-origin として卒業するなら不要。external として卒業する場合だけ必要」に。 |
| `docs/security.md` | L411 の「opaque `null` origin a sandboxed Tool iframe sends」と L520 の「sandbox ... still blocks the Tool from reading the host DOM」を、first-party では成立しない旨に。CORS が foreign origin を拒否する規則自体は変えない。 |
| `docs/security/api-cors.md` | L15 / L73 / L281–L286 の「sandboxed Tool iframe の opaque origin」を、first-party frame は real origin を送る、に更新。 |
| `docs/development.md` L420 | 「loaded in a sandboxed iframe」→「loaded in a Tool iframe」。 |
| `docs/tools/inventory.md` L163 | `mic-level` の external 前提の記述を「same-origin 卒業なら sandbox 不要 / external 卒業なら opaque origin のため allow-same-origin の別判断」に。 |
| `quality/threat-model.json` `sandbox-origin-escape` | first-party では全 frame が host origin なので、この scenario を「first-party Tool build の侵害」に書き換え、mitigation を provenance / review / artifact inventory に変更する。`allow-same-origin` の拒否は external の制御として残す。 |
| `quality/bundle-budget.json` L92 | 「loaded inside a sandboxed iframe」→「loaded inside a Tool iframe」。 |
| `src/server.ts` L303 | 「under what sandbox / referrer policy」→「under what referrer / origin / permission policy」。 |
| `src/tools/embed-privacy.ts` L7 | 「framed (sandbox tokens, referrer policy, ...)」→「framed (referrer policy, frame origin, ...)」。 |
| `src/tools/embed-consent-notice.stories.tsx` L152 | 「declared sandbox / referrer policy」→「declared referrer policy」。 |
| `src/personal/usable-product-publication/UsableProductPublication.preview.ts` L332 | 「iframe は `sandbox: allow-scripts` / `referrer_policy: no-referrer`」→「iframe は `referrer_policy: no-referrer`（sandbox なし、ADR-0020）」。 |
| `vite.config.ts` L128–L145 | opaque origin の説明を削除。wildcard CORS は**挙動を変えず**、「ADR-0020 以前の理由で付いており、same-origin の module 読み込みには不要。公開 static asset なので残す。削除は別の header tightening ticket」と書く。 |
| `scripts/seo-head-contract.mjs` L169 / `scripts/rewrite-asset-paths.mjs` L30 / `scripts/rewrite-asset-paths.test.mjs` L110 / `scripts/check-bundle-budget.mjs` L450 / `scripts/capture-tool-previews.mjs` L18 | 「sandboxed iframe」を「Tool iframe」に。**挙動は変えない**。 |
| `scripts/tools-embed-policy-report.mjs` | レポート文言を新 policy に合わせる。first-party は「sandbox: none (first-party)」。 |
| `docs/adr/ADR-0006-tools-submodule-policy.md` | Re-evaluation triggers に 1 行追加: 「The sandbox half of the trigger was decided by ADR-0020 (Issue #825): first-party Tool frames carry no sandbox.」 |

**書き換えない（歴史的記録）**: `docs/verification/backlog/closure-audit-2026-10-31.md`、
`docs/verification/tools/completion-inventory.md`、`quality/issue-closure-ledger.json`。
現在の契約として読まれる箇所だけ、必要なら 1 行の注記を足す。

---

## 4. 受け入れ測定

### 4.1 `e2e/tools-readmark.spec.ts`（新規、CI で測る）

`pnpm run build` 後の `pnpm run preview` に対して:

1. `/tools/readmark` を開く。
2. iframe `title="readmark Tool"` が存在し、**`sandbox` 属性が無い**。
3. frame の `window.origin` が `new URL(page.url()).origin` と一致する。
4. frame 内で:
   ```js
   await frame.evaluate(() => new Promise((resolve) => {
     const req = indexedDB.open('readmark-probe');
     req.onsuccess = () => resolve('ok');
     req.onerror = () => resolve('onerror');
   }))
   ```
   が `'ok'`。`localStorage.setItem('probe','1')` も `'ok'`。
5. frame の本文に「ライブラリは空です。上のボタンから文書を追加してください。」が
   出る（timeout 15s）。**「読み込み中…」のままにならない。**
6. console に `SecurityError` が出ない。`cdn-cgi/rum` の CORS 失敗も出ない
   （host origin になったため）。
7. `/tools/prototype`: activation 前に consent notice、third-party 要求 0。
   activation 後に iframe が描画され、要求先が manifest の 4 origin に一致する
   （既存 test を維持）。

### 4.2 negative control（gate が新しい契約を固定していること）

1. `readmark` の `delivery.iframe` に一時的に `"sandbox": "allow-scripts"` を足す。
2. `pnpm run tools:check` が **非 0** で終わり、
   `embed.sandbox.not-allowed-for-first-party` を含む。
3. 元に戻す。

### 4.3 その他の測定

| 項目 | 期待値 |
| --- | --- |
| `grep -rn '"sandbox"' src/tools/manifest.json` | 0 件 |
| 描画 HTML の `/tools/readmark` | `<iframe ...>` に `sandbox` が無い |
| `pnpm run validate:fast`（`.tmp/supervisor/bin/vfast` 経由） | 全 step green、step 数と exit code を報告 |
| `pnpm run validate:integration` | green（build / bundle budget / wrangler dry-run / storybook） |
| `pnpm run tools:check` | green |
| `pnpm run security:headers:check` | green |
| 画面証跡 | `/tools/readmark` の 1440×900 と 390×844 を **WebP** で `docs/verification/tools/tool-first-party-delivery-{1440,390}.webp` に置く（PNG 禁止、quality 82） |
| `docs/verification/tools/tool-first-party-delivery.md` | 上の測定値を before / after の表で記録。ADR-0020 への link。 |

### 4.4 実測の報告フォーマット

worker は次の表を PR / Issue コメントに**実測値で**埋める。

| 項目 | before（2026-11-02 production） | after（worker 実測） |
| --- | --- | --- |
| iframe `sandbox` 属性 | `allow-scripts` | （なし） |
| frame `window.origin` | `null`（opaque） | `https://rebuildup.dev`（local は preview origin） |
| `indexedDB.open()` | `SecurityError` | `ok` |
| `localStorage` | `SecurityError` | `ok` |
| readmark 表示 | `読み込み中…` | `ライブラリは空です。…` |
| `/tools/prototype` activation 前の third-party 要求 | 0 | 0 |

---

## 5. やらないこと

- **Tool の成果物 / upstream checkout を書き換えない。** `external/readmark` の
  pin も上げない。
- **`allow-same-origin` を足さない。** 壊れたときにこれをやったら決定違反。
- **direct 配信に切り替えない。** iframe を外さない。
- **別 origin（`tools.rebuildup.dev` 等）を作らない。** 新しい Worker / binding /
  DNS / cookie 設計は別の owner 決定。
- **third-party origin の宣言を外さない。** `embed-privacy.ts` の
  `click_to_load` を壊さない。
- **Issue #786 の storage-free 設計を実装しない。** 撤回済み。readmark の
  import を有効にしない（pinned build は import 無効の足場）。
- **`mic-level`（#598）を有効化しない。** `getUserMedia` は維持し、
  `host_disabled` のまま。休眠宣言から `sandbox` を外すだけ（ADR §4.5）。
- **旧選択肢 B（storage を使わない設計に寄せる）を実装しない。** 却下済み。
- **release PR を merge しない / tag を push しない / GitHub Release を作らない**
  （AGENTS.md §6 human gate）。
- **`src/routes/tools.$slug.tsx` の blocked 文言以外の公開コピーを書き換えない。**
  変える場合は `copy:approval:check` の扱いを PR に書く。

---

## 6. 実装順序 / PR

1. worktree（`~/work/my-web-2026.825`、branch `825`）で
   `git submodule update --init --recursive` と `pnpm install` を実行する
   （新しい worktree は submodule が無いと `publication:check` が落ちる）。
2. ADR-0020 とこの spec は branch `825` に**既に commit 済み**（Draft PR がある）。
   内容を再生成しない。ADR 本文は owner の review 待ちなので、実装中に決定を
   変える必要が出たら ADR を勝手に書き換えず Issue に BLOCKER として報告する。
3. §3.1–§3.5 を 1 commit にまとめる（manifest / schema / policy / registry /
   route）。壊れた gate を中間状態で残さない。
4. §3.6 のテスト・fixture を同じ PR で直す。`pnpm run tools:check` と
   `pnpm run typecheck` を先に通す。
5. §3.7 のドキュメントを更新する。
6. §4.1 の e2e を追加し、`pnpm run build` → `pnpm run preview` で実測する。
7. `vfast` と `validate:integration` を通す。
8. 既存の **Draft PR**（base `release-0-8-1`、linked Issue #825）に push する。
   `ui-change` label で E2E を走らせる。green になったら ready にする。
   **merge しない**（AGENTS.md §6 human gate）。
9. PR 本文に §4.4 の表、gate の結果、変更ファイル、#786 との関係を書く。

---

## 7. #786 との関係

- #786 に投稿した storage-free UX 設計は**撤回**した（Issue #825 の決定で
  原因が消えるため）。`786-fallback-wip` は使わない。
- #786 の残作業は upstream readmark の pin bump（`906c90e` → upstream `main`）で
  あり、別 ticket。pinned build の import は無効のままでよい。
- #825 は「空 library に到達する」まで。import / reader の実機能は #825 の
  受け入れに含めない。

---

## 8. 判断に迷ったときの優先順位

1. ADR-0020（決定）。
2. Issue #825 の受け入れ条件。
3. この spec。
4. 既存の `embed-policy.ts` の external 規則（壊さない）。
5. 既存の実装（読める形に合わせる）。

新しい製品判断（direct 配信、別 origin、copy の書き換え、upstream の変更）が
必要になったら、実装で決めずに Issue に BLOCKER として報告する。
