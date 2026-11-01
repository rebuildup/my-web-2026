# Tool completion inventory（Issue #769, measured 2026-11-01）

> 目的: `src/tools/manifest.json` の 15 Tool のうち、まだ利用できない 13 件に
> ついて「何が blocker か」「host 側で完結するか、Tool repo 側の変更が必要か」
> 「次にどれから着手するか」を、pinned SHA 時点の実体から記録する。
>
> これは Issue #769 の棚卸し成果物であり、個別 Tool の実装判断ではない。
> 個別の実装は #353〜#361 / #770〜#773 が持つ。

## 1. 測定方法

- `src/tools/manifest.json` の `source.pinned_sha` を正として、各 repo の
  pinned SHA の tarball を `gh api repos/rebuildup/<repo>/tarball/<sha>` で取得し、
  read-only で `package.json` / `LICENSE` / `src/**` / lockfile を読んだ。
- 現在の HEAD も併記した（pinned SHA より新しい repo がある）。
- 実行時挙動は測定していない。**「build できる」「実際に動く」は未検証**であり、
  本表は静的証拠だけを根拠にする。
- 既存の `docs/tools/inventory.md`（2026-09-27 時点）は上書きしない。
  本表は 2026-11-01 時点の再測定結果として併存させる。

## 2. 全体像

| 状態 | 件数 | slug |
| --- | --- | --- |
| 利用可能（`same_origin_static`） | 2 | `prototype`, `readmark` |
| `host_disabled` / `needs_tool_side_fix` | 12 | `text-counter`, `color-palette`, `sequential-png-preview`, `svg2tsx`, `business-mail-block`, `code-type-p5`, `fillgen`, `qr-generator`, `pomodoro`, `history-quiz`, `pi-game`, `ae-expression` |
| `host_disabled` / `external_exception` | 1 | `mic-level` |

**結論（最重要）: 13 件すべてで Tool repo 側の変更が必須。host repo 側の
操作だけで `same_origin_static` にできる Tool は 1 件も無い。**

理由は共通で、13 repo はいずれも Next.js の **component library** であり、
`main: ./src/index.ts` を export するだけで、`vite.config.ts` / `index.html` /
`build` script を持たない。`scripts/build-tools.mjs` は manifest の
`build.command`（`pnpm install --frozen-lockfile && pnpm run build`）を
submodule 内で実行するが、この `build` script が存在しないため現状のままでは
必ず失敗する。manifest の `delivery.disabled_reason` は正しい。

現在の HEAD でも状況は同じ（HEAD 時点の tree にも `vite.config` / `index.html`
は無い）。pinned SHA の bump だけでは解決しない。

## 3. マトリクス

### 3.1 識別と build

| slug | canonical repo | pinned SHA | upstream HEAD | default branch | package manager（manifest） | 実 lockfile | build path（pinned） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `text-counter` | `tool-text-counter` | `5371479f` | `42b6643c` | main | pnpm | `bun.lock` | なし（`scripts` 無し） |
| `color-palette` | `tool-color-palette` | `0eb51503` | `9c3b9e5c` | main | pnpm | `bun.lock` | なし（`scripts` 無し） |
| `sequential-png-preview` | `tool-sequential-png-preview` | `2bcad8a1` | `36d1af3e` | main | pnpm | `bun.lock` | なし（`scripts` 無し） |
| `svg2tsx` | `tool-svg2tsx` | `4e85e922` | `d79c198f` | main | pnpm | `bun.lock` | なし（`scripts` 無し） |
| `business-mail-block` | `tool-business-mail-block` | `d1ea054a` | `904b97f6` | main | bun | `bun.lock` | なし（`lint`/`type-check` のみ） |
| `code-type-p5` | `tool-code-type-p5` | `509c2873` | `e7b47785` | main | pnpm | `bun.lock` | なし（`scripts` 無し） |
| `fillgen` | `tool-fillgen` | `01d53b84` | `01d53b84` | main | pnpm | **無し** | なし（`scripts` 無し） |
| `qr-generator` | `tool-qr-generator` | `19fd50bb` | `576f666f` | main | pnpm | **無し** | なし（`scripts` 無し） |
| `pomodoro` | `tool-pomodoro` | `954cfd89` | `954cfd89` | main | pnpm | **無し** | なし（`scripts` 無し） |
| `history-quiz` | `tool-history-quiz` | `72328139` | `72328139` | main | pnpm | **無し** | なし（`scripts` 無し） |
| `pi-game` | `tool-pi-game` | `9e19ec5d` | `da77ee62` | **develop** | pnpm | **無し** | なし（`scripts` 無し） |
| `ae-expression` | `tool-ae-expression` | `cd136e25` | `739ca4a6` | main | pnpm | **無し** | なし（`scripts` 無し） |
| `mic-level` | `tool-mic-level` | `5df7ac64` | `8bc77be4` | main | pnpm | **無し** | なし（`test`/`lint`/`type-check` のみ） |

pinned SHA の bump だけで HEAD に追従できる repo は 11 件（`fillgen` /
`pomodoro` / `history-quiz` は pinned = HEAD）。ただし前述のとおり HEAD にも
build path は無いので、bump は build 追加 PR の後に行う。

### 3.2 依存・権利・実行時面

| slug | 主な runtime 依存 | `next/*` import | 外部 origin（実行時） | browser API / capability | license 証拠 | review record |
| --- | --- | --- | --- | --- | --- | --- |
| `text-counter` | `js-tiktoken` | 無し | 無し | clipboard | `LICENSE` MIT | unverified |
| `color-palette` | react のみ | 無し | 無し | clipboard, localStorage | `LICENSE` MIT | unverified |
| `sequential-png-preview` | react のみ | `next/image` | 無し | file input, canvas 2d, object URL | `LICENSE` MIT | unverified |
| `svg2tsx` | react のみ | 無し | 無し（`example.com` はサンプル文字列） | clipboard | `LICENSE` MIT | unverified |
| `business-mail-block` | `@hello-pangea/dnd`, `lucide-react` | 無し | 無し | clipboard, drag & drop | `LICENSE` MIT | unverified |
| `code-type-p5` | `p5`, `jszip` | 無し | 無し | canvas, video 書き出し, download | `LICENSE` MIT | unverified |
| `fillgen` | react のみ | `next/link` | 無し | clipboard, DOM 操作 | `LICENSE` MIT | unverified |
| `qr-generator` | `qrcode`, `qrcode.react` | 無し | 無し | canvas → PNG download | `LICENSE` MIT | unverified |
| `pomodoro` | `lucide-react` | `next/image` | **`www.youtube.com`（埋込プレイヤー）**, `via.placeholder.com` | **Web Notifications**, vibrate, localStorage / sessionStorage | `LICENSE` MIT | unverified |
| `history-quiz` | react のみ | 無し | 無し | DOM 直接操作（wrapper / tooltip 挿入） | `LICENSE` MIT | unverified |
| `pi-game` | react のみ | `next/link` | 無し | fullscreen, keyboard | `LICENSE` MIT | unverified |
| `ae-expression` | `lucide-react` | `next/link` | 無し | clipboard, localStorage | `LICENSE` MIT | unverified |
| `mic-level` | `next`（dependencies にも）, `lucide-react` | `next/link` | 無し（`obsproject.com` はリンク） | **getUserMedia**（microphone） | `LICENSE` MIT | unverified |

`quality/tool-artifact-inventory.json` は prototype / readmark 以外すべて
`license: unverified` / `dependencies: unverified` / `outbound.observed: false`。
これは「未検証」であって「問題なし」ではない。build して
`pnpm run tools:artifact:update` を実行するまで verified にできない。

## 4. blocker の具体（Tool ごと）

いずれも **Tool repo 側**の作業。host 側の PR はその後に 1 本だけ置く。

1. **全 13 件共通 — standalone build の追加**: `vite.config.ts`（react plugin）、
   `index.html`（`#root`）、`src/main.tsx`（各 `*App.tsx` を mount）、
   `package.json` の `build` script と devDependencies、lockfile。
   asset path は Vite 既定の root-absolute でよい（host の
   `scripts/rewrite-asset-paths.mjs` が `/tools/<slug>/app/` へ書き換える）。
2. **`next/*` 依存の除去（6 件）**: `ae-expression`, `fillgen`, `mic-level`,
   `pi-game`（`next/link`）、`pomodoro`, `sequential-png-preview`（`next/image`）。
   standalone では Next のルーターも画像最適化も存在しない。
3. **lockfile の追加（7 件）**: `fillgen`, `qr-generator`, `pomodoro`,
   `history-quiz`, `pi-game`, `ae-expression`, `mic-level`。
   `pnpm install --frozen-lockfile` は lockfile 無しでは成立しない。
4. **package manager の一致**: manifest は 12 件を `pnpm` と記録しているが、
   `bun.lock` を持つ repo が 5 件ある。standalone build 時にどちらへ揃えるかを
   Tool 側で決め、manifest と一致させる（`business-mail-block` は manifest も
   `bun` で一致済み）。
5. **DOM 直接操作の検証（2 件）**: `history-quiz` は `useEffect` で
   wrapper / tooltip を差し込む。StrictMode の二重 mount で重複しないことを
   Tool 側で確認する。`fillgen` も `document.createElement` を多用する。
6. **host 相対 import の除去（7 件）**: `text-counter` / `color-palette` /
   `sequential-png-preview` / `svg2tsx` / `code-type-p5` が
   `../../../../src/components/tools-ui/RawDOMContainer` を、
   `ae-expression` / `business-mail-block` が
   `../../../../src/components/tools-ui/ToolWrapper` を import している。
   いずれも my-web-2025 側のファイルで Tool repo には存在しない。
   standalone build では Tool repo が自前の frame を持つ必要がある。
7. **コンテンツが host 側にある Tool（1 件）**: `history-quiz` は実行時に
   `/history-quiz.html` を fetch するが、その 89,935 bytes の HTML は
   `my-web-2025/public/history-quiz.html` にあり、Tool repo には無い。
   単体 build にはコンテンツの移設が必要で、これは build 作業ではなく
   コンテンツ所有権・著作権の判断である。
8. **実画面の操作確認**: 各 Issue の受け入れ条件どおり、その Tool の主要操作
   （採点・コピー・ダウンロード・描画）を sandbox iframe 内で確認する。

## 5. host 側で残る論点（Tool 実装後に判断が要るもの）

sandbox は現状 `allow-scripts` のみ（`prototype` / `readmark`）。
`src/tools/embed-policy.ts` は `allow-same-origin` と `allow-top-navigation*` を
禁止し、`allow-downloads` / `allow-forms` / `allow-modals` 等は
**書面理由つき**で許可する。したがって次の gap は manifest の変更を伴う。

| 論点 | 該当 Tool | 必要な host 側判断 |
| --- | --- | --- |
| クリップボード書き込み | `text-counter`, `color-palette`, `svg2tsx`, `ae-expression`, `fillgen`, `business-mail-block` | `iframe.allow` に `clipboard-write` を付けるか、Tool 側でフォールバック（`execCommand` / 手動コピー UI）にするか |
| ファイルダウンロード | `qr-generator`, `code-type-p5` | sandbox に `allow-downloads` を追加するか（理由記述が必要） |
| 全画面 | `pi-game` | `allowfullscreen` / `allow-presentation` の扱い |
| Web Notifications | `pomodoro` | opaque origin の sandbox frame では許可要求が成立しない。`allow-same-origin` は禁止なので、Tool 側で通知を使わない設計へ寄せるか、`#598` と同種の owner 判断が必要 |
| 第三者の埋込 | `pomodoro` | `www.youtube.com` を実行時に読む。`delivery.privacy` の宣言と consent 表示が必要（`src/tools/embed-privacy.ts`） |
| mic | `mic-level` | **停止**。`#598` の owner 判断まで有効化しない |

これらは「Tool 実装が終わった後」に判断すればよい。今すぐ決める必要はない。

## 6. end-to-end の最初の候補

リスクの低さ = (a) 外部 origin が無い、(b) 権限付与が必要な API が無い、
(c) `next/*` import が無い、(d) 依存が小さい、の順で評価した。

### 第 1 候補: `color-palette`（Issue #770）— 上流 PR 起票済み

- 外部 origin 無し、`next/*` import 無し、runtime 依存は react のみ。
- host 相対 import は 1 箇所（`RawDOMContainer`）のみで、Tool repo 所有の
  frame に置き換えれば standalone になる。
- 権限 API は clipboard のみ。opaque origin では async Clipboard が
  permissions policy で拒否されるが、`document.execCommand("copy")` の
  フォールバックで動作することを実測済み（8 節）。
- 上流 PR: rebuildup/tool-color-palette#6（Issue #5）。Vite 足場、host import
  の置換、storage / clipboard の opaque origin 対応を含む。merge は owner 判断。

### 第 2 候補: `text-counter`（Issue #353）/ `svg2tsx`（#356）

- `color-palette` と同じ構造（react のみ + `RawDOMContainer` + clipboard）。
  `text-counter` は `js-tiktoken` を追加で持つ。
- 1 件目の手順がそのまま横展開できる。

### 第 3 候補: `history-quiz`（Issue #772）— コンテンツ判断待ち

- 構造は最も単純（外部 origin 無し・権限 API 無し・react のみ）だが、
  quiz 本体の HTML が `my-web-2025/public/history-quiz.html` にしか無い。
  移設の可否（コンテンツ所有権）が決まるまで着手しない。

`pomodoro` と `mic-level` は最後尾。前者は通知と第三者埋込、後者は #598 の
owner 判断が前提で、他 Tool と同じ手順では進められない。

## 7. 見積もりと順序

1 Tool = 上流 1 PR + host 1 PR。上流 PR は「Vite の足場 + 既存 `next/*` の
除去 + lockfile」で、1 件あたり 30〜90 分程度の作業 + 人間レビュー。
host PR は submodule 追加、manifest の `same_origin_static` 化、pinned SHA、
artifact inventory 再生成、privacy / sandbox、desktop / mobile WebP、
`validate:integration` で 1 件あたり 1 時間程度。

推奨順序:

1. `color-palette` (#770) — 上流 PR 起票済み。contract を 1 周通す。
2. `text-counter` (#353) → `svg2tsx` (#356) → `qr-generator` (#355) —
   clipboard / download の host 側判断を固めて横展開する。
3. `pi-game` (#354) → `ae-expression` (#773) → `sequential-png-preview` (#357)
   → `fillgen` (#359) → `business-mail-block` (#771)。
4. `code-type-p5` (#361) → `pomodoro` (#358) — 重量・第三者依存のため後回し。
5. `history-quiz` (#772) — quiz コンテンツの移設可否が決まるまで保留。
6. `mic-level` (#360) — **#598 の owner 判断まで停止**。

上流 13 repo の変更は my-web-2026 の PR に混ぜない（ADR-0006 §3）。
各上流 PR の merge SHA で `source.pinned_sha` を bump する。

## 8. 上流 PR の実測（`color-palette`, 2026-11-01）

- 上流 Issue: rebuildup/tool-color-palette#5
- 上流 PR: rebuildup/tool-color-palette#6（Ready）。head
  `ab049e618641e82d47e417e92b5cf67deac2b760`。**merge は owner 判断**。
- 上流で追加したもの: `vite.config.ts` / `index.html` / `src/main.tsx` /
  `tsconfig.json`、`build` ほか script、devDependencies（Vite 7.3.x /
  plugin-react 5.2.x / TypeScript 5.9.x）、host import を置き換える
  `AppFrame`、opaque origin 向けの storage guard と copy fallback。
- 実測: `bun install --frozen-lockfile`（変更なし）、`bun run type-check`
  （exit 0）、`bun run build`（`dist/index.html` + 209.81 kB JS）。
  `<iframe sandbox="allow-scripts">` 内で初期表示・5 色生成・コピー・
  保存（in-memory）が動作し、console error なし。通常 origin では
  reload 後も保存が復元される。
- host の `scripts/rewrite-asset-paths.mjs` を乾式実行し、
  `/tools/color-palette/app/assets/...` への書き換えと `crossorigin` の
  除去を確認した（`public/_headers` の
  `Access-Control-Allow-Origin: *` と対になる契約）。
- runtime 依存・ライセンス（MIT）は不変。外部 origin への通信は無い。

## 9. owner に決めてほしいこと

済み:

- 上流 PR の起票 → 認可済み（2026-11-01 指示）。
- 着手順序 → 上記 7 節に更新（`color-palette` を先頭、`history-quiz` は保留）。
- 既存 9 件（#353〜#361）への `target:0.8.1` → 付与済み。

未決:

1. **`history-quiz` の quiz コンテンツ**（`my-web-2025/public/history-quiz.html`,
   89,935 bytes）を Tool repo へ移設してよいか。コンテンツの所有権・
   著作権の判断が必要。
2. **上流 PR #6 の merge**。merge commit が pinned SHA になるため、
   host 側 PR（submodule / manifest / artifact inventory / WebP /
   `validate:integration`）はその後にしか起票できない。

## 10. 再測定手順

```bash
# pinned SHA の tarball を read-only で取得する
gh api repos/rebuildup/<repo>/tarball/<pinned_sha> > /tmp/<slug>.tar.gz
mkdir -p .tmp/<slug> && tar -xzf /tmp/<slug>.tar.gz -C .tmp/<slug> --strip-components=1

# 確認する項目
#   - package.json の scripts / packageManager / dependencies / peerDependencies
#   - vite.config.* / index.html / src/main.tsx の有無
#   - lockfile の種類
#   - src/** の next/* import
#   - src/** の host 相対 import（../../../../src/...）
#   - src/** が fetch する host 側ファイル（例: /history-quiz.html）
#   - src/** の http(s):// origin
#   - src/** の browser API（getUserMedia / Notification / clipboard / storage / canvas）
```

## 関連

- Issue #769（本棚卸しの親）
- 個別 Issue: #353 #354 #355 #356 #357 #358 #359 #360 #361 / #770 #771 #772 #773
- owner gate: #598（`mic-level` の `allow-same-origin`）
- 契約: `docs/adr/ADR-0006-tools-submodule-policy.md`
- embed policy: `src/tools/embed-policy.ts`, `docs/tools/embed-policy.md`
- privacy: `src/tools/embed-privacy.ts`, `docs/tools/embed-privacy.md`
- ライセンス・依存検証: Issue #466, `quality/tool-artifact-inventory.json`
