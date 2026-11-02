# Tool completion inventory（Issue #769 / measured 2026-11-02）

> 目的: `src/tools/manifest.json` の **15 Tool すべて**を「利用可能」にする
> ために何が必要か を、pinned SHA 時点の実体から記録する。13 件は
> `host_disabled` であり、残り 2 件（`prototype` / `readmark`）は利用可能だが
> ADR-0020 の着地と機能面の残作業を持つ。
>
> これは Issue #769 の棚卸し成果物であり、個別 Tool の実装判断ではない。
> 個別の実装は §5 に記した各 Tool の Issue が持つ。
>
> 先行文書: ADR-0020（Accepted、`docs/adr/ADR-0020-tool-first-party-same-origin-delivery.md`）。

## 0. 決定の出所

| 事項 | 誰が決めたか | 出所 |
| --- | --- | --- |
| 「全 15 Tool を利用可能にする」 | **owner** | Issue #769 本文（2026-11-02 の逐語引用） |
| `host_disabled` は恒久状態ではない | engineering decision | Issue #769 決定 1・2 / ADR-0020 §2.6 |
| ADR-0020 を Accepted にする | engineering decision | ADR-0020 §0 |
| `mic-level` を `same_origin_static` へ移す | engineering decision | ADR-0020 §4.5 / Issue #769 決定 3 |
| 15 件それぞれの終了条件・検証方法・実行順・担当 | engineering decision | 本書 §5・§6 |
| **最初の end-to-end 候補は `color-palette`** | **owner** | Issue #769 への指示（2026-11-02） |
| **共通 recipe**（`index.html` + `src/main.tsx` + `vite.config.ts` の `base: './'`` + build script）を残りへ横展開 | **owner** | 同上 |
| 上流 repo の変更の目標 | **owner** | 同上（下記 §0.1） |

owner が出したのは**要件**だけである。sandbox / iframe / ADR 本文の採否、
本書の順序と担当は AGENTS.md §8 の決定優先順位から導出した
**engineering decision** であり、owner の承認を意味しない
（AGENTS.md §6 / `docs/runbook/issue-lifecycle.md`）。
ただし「最初の end-to-end 候補」と「共通 recipe」は **owner が指定した**
（§0.1）。

### 0.1 owner 指示（原文、2026-11-02）

> 最初の end-to-end 候補は **color-palette** に決めた。別 worker が
> tool-color-palette リポジトリで standalone Vite build を追加中。
> #769 の inventory / 実行順では color-palette を **pilot** として先頭に置き、
> recipe（`index.html` + `src/main.tsx` + `vite.config.ts` の `base: './'`` +
> build script）を残りへ横展開する順序にする。

要点（owner の原意）:

> コンポーネントライブラリからスタンドアローンで使えるように変える。
> **内容は静的コンテンツでいい。**

したがって上流 repo 側の作業は「component library を **standalone で起動できる
アプリ**に変える」ことであり、**動的なデータ供給や backend を要求しない**。
静的コンテンツでよいことが、依存と実装範囲の最小化を可能にする。

## 1. 測定方法（2026-11-02）

- 13 件（`host_disabled`）は `src/tools/manifest.json` の
  `source.pinned_sha` を正として、
  `gh api repos/rebuildup/<repo>/tarball/<pinned_sha>` で tarball を取得し、
  read-only で `package.json` / `LICENSE` / lockfile / `src/**` を読んだ。
- 2 件（`prototype` / `readmark`）は submodule を checkout して同じ項目を
  読んだ（`external/prototype` = pinned `335e0e8`、`external/readmark` =
  pinned `906c90e`）。
- upstream の default branch の最新 commit SHA と open PR を
  `gh api repos/rebuildup/<repo>` / `gh pr list --repo …` で取得した。
- **実行時挙動は測定していない。** upstream の build を実行していないため、
  「build できる」「実際に動く」は未検証である（§10）。
- 既存の `docs/tools/inventory.md`（2026-09-27 時点）は上書きしない。

## 2. 全体像（15 件）

| 状態 | 件数 | slug |
| --- | --- | --- |
| 利用可能（`same_origin_static`、2026-11-02 時点） | 2 | `prototype`, `readmark` |
| `host_disabled`（**Tool repo 側の変更が必須**） | 12 | `text-counter`, `color-palette`, `sequential-png-preview`, `svg2tsx`, `business-mail-block`, `code-type-p5`, `fillgen`, `qr-generator`, `pomodoro`, `history-quiz`, `pi-game`, `ae-expression` |
| `host_disabled`（Tool repo 側の変更が必須 + 権限条件） | 1 | `mic-level` |

**結論 1: 13 件すべてで Tool repo 側の変更が必須。** host repo 側の操作だけで
`same_origin_static` にできる Tool は 1 件も無い。13 repo はいずれも Next.js の
**component library** で、`main: ./src/index.ts` を export するだけで、
`vite.config.ts` / `index.html` / `build` script を持たない。
`scripts/build-tools.mjs` は manifest の `build.command` を submodule 内で
実行するが、この `build` script が存在しないため現状のままでは必ず失敗する。
manifest の `delivery.disabled_reason` は正しい。

**結論 2: 13 件は host 側だけの多少の調整では終わらない。** 共通して必要なのは
§3 の build recipe であり、個別差分は §5 に記す。

**結論 3: 2 件（prototype / readmark）も「利用可能で終わり」ではない。**
残る作業は ADR-0020 の実装（#825）に伴う再検証と、readmark の import が
pinned build では無効である点（§5.1）。

## 3. 共通 build recipe（1 つに決定）

**owner が指定した recipe**（§0.1）を、13 件に横展開の基準として固定する。
差異は同じ recipe の「repo ごとの選択肢」に留める。

この recipe は **pilot である `color-palette` の upstream 実装で確定する**
（別 worker が `rebuildup/tool-color-palette` で standalone Vite build を
追加中）。本章の表は、pilot の実装で**実際に使われた形**を確定したうえで
差分を反映する（pilot の merge が本表の更新の契機）。

| # | 項目 | 決定した形 | 実測の出所 |
| --- | --- | --- | --- |
| 1 | `vite.config.ts` | `defineConfig({ base: './', plugins: [react()] })`。**`base: './'` は owner 指定**（§0.1）。`build.outDir` は Vite 既定の `dist` のまま（manifest の `build.output_dir: "dist"` と一致） | owner 指定（§0.1）/ 稼働中の 2 例は `base` 未指定: `external/prototype/vite.config.ts`、`external/readmark/vite.config.ts` |
| 2 | `index.html` | ルート要素 + `<script type="module" src="/src/main.tsx">`。要素 id は Tool ごとに自由度あり（`#root` / `#app-root`） | `external/prototype/index.html`、`external/readmark/index.html` |
| 3 | `src/main.tsx` | `createRoot` で app component を mount する entry。library face（`src/index.ts` の export）と standalone face（`src/main.tsx`）を分ける構成なら、その分割を README に記す | `external/prototype/src/`、`external/readmark/src/App.tsx` |
| 4 | `package.json` | `build` script を持つ。型エラーで build を止める repo は `tsc -b && vite build`、止めない repo は `tsc -b --noCheck && vite build`。`devDependencies` に `vite` / `@vitejs/plugin-react` / `typescript` | prototype `package.json` scripts / readmark `package.json` scripts |
| 5 | lockfile | manifest の `build.package_manager` と一致させる（`pnpm` → `pnpm-lock.yaml`、`bun` → `bun.lock`）。**lockfile 無しでは `pnpm install --frozen-lockfile` は成立しない** | §4.1 の lockfile 列 |
| 6 | `next` の除去 | `dependencies` / `peerDependencies` の `next` を外す。`peerDependencies.next` は auto-install で Next.js を入れ込むため、**残すと standalone build の前提が崩れる** | 13 repo の `package.json`（`peerDependencies.next: ^16.3.0`、mic-level は `dependencies` にも `next`） |
| 7 | host 相対 import の除去 | `../../../../src/components/tools-ui/…` を Tool repo 内のローカル frame に置換する（host の `src/**` を Tool が参照してはならない — ADR-0006 §2） | §4.1 の host 相対 import 列 |
| 8 | asset path | `base: './'` により**相対パス**（`./assets/…`）で出力され、`/tools/<slug>/app/index.html` から相対解決されて `/tools/<slug>/app/assets/…` に届く。**新規 Tool では host 側の asset path rewrite（`scripts/rewrite-asset-paths.mjs:47`）が不要になる** — 稼働中の 2 例は `base` 未指定（root-absolute）で host 側 rewrite に依存しているため、**この差分は pilot の host PR で実測して確かめる**（既存 2 例の rewrite を外してよいかは pilot とは別の判断） | owner 指定（`base: './'`）/ 既存 2 例: `external/*/vite.config.ts`（`base` 未指定）+ `scripts/rewrite-asset-paths.mjs` |

host 側の契約（Tool repo 側が満たすべき条件の対）:

- `scripts/build-tools.mjs` — manifest の `build.command` を submodule 内で実行し、
  `build.output_dir` を `dist/client/tools/<slug>/app/` へ mirror する
  （`scripts/build-tools.mjs:23-24`、`:361-376`）。package manager の version
  下限も検査する（`:105`、`:333`）。
- `scripts/check-tools-manifest.mjs:200-210` — `same_origin_static` は
  `delivery.artifact_path` が `^/tools/<slug>(/…)?$` に一致し、
  `source.submodule_path` が**実際の gitlink** でなければならない
  （submodule 必須）。
- `scripts/check-security-headers.mjs` — manifest の `delivery.iframe.allow` と
  `public/_headers` の Permissions-Policy 宣言が一致していなければ落ちる。

## 4. マトリクス（15 件）

### 4.1 識別・build 構成（実測）

| slug | canonical repo | pinned SHA | default branch | manifest pm | 実 lockfile | `scripts` | `vite.config` / `index.html` | `next/*` import | host 相対 import |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `prototype` | `ProtoType` | `335e0e86` | main | pnpm | `pnpm-lock.yaml`（+ `package-lock.json` が併存） | dev / build / typecheck / lint / test / e2e | **ある**（稼働中） | 無し | 無し |
| `readmark` | `readmark` | `906c90e5` | main | bun | `bun.lock` | dev / build / typecheck / lint / test / validate | **ある**（稼働中） | 無し | 無し |
| `text-counter` | `tool-text-counter` | `5371479f` | main | pnpm | `bun.lock` | **無し** | 無し / 無し | 無し | `RawDOMContainer` |
| `color-palette` | `tool-color-palette` | `0eb51503` | main | pnpm | `bun.lock` | **無し** | 無し / 無し | 無し | `RawDOMContainer` |
| `sequential-png-preview` | `tool-sequential-png-preview` | `2bcad8a1` | main | pnpm | `bun.lock` | **無し** | 無し / 無し | `next/image` | `RawDOMContainer` |
| `svg2tsx` | `tool-svg2tsx` | `4e85e922` | main | pnpm | `bun.lock` | **無し** | 無し / 無し | 無し | `RawDOMContainer` |
| `business-mail-block` | `tool-business-mail-block` | `d1ea054a` | main | bun | `bun.lock` | lint / format / type-check のみ | 無し / 無し | 無し | `ToolWrapper` |
| `code-type-p5` | `tool-code-type-p5` | `509c2873` | main | pnpm | `bun.lock` | **無し** | 無し / 無し | 無し | `RawDOMContainer` |
| `fillgen` | `tool-fillgen` | `01d53b84` | main | pnpm | **無し** | **無し** | 無し / 無し | `next/link` | 無し |
| `qr-generator` | `tool-qr-generator` | `19fd50bb` | main | pnpm | **無し** | **無し** | 無し / 無し | 無し | 無し |
| `pomodoro` | `tool-pomodoro` | `954cfd89` | main | pnpm | **無し** | **無し** | 無し / 無し | `next/image` | 無し |
| `history-quiz` | `tool-history-quiz` | `72328139` | main | pnpm | **無し** | **無し** | 無し / 無し | 無し | 無し |
| `pi-game` | `tool-pi-game` | `9e19ec5d` | **develop** | pnpm | **無し** | **無し** | 無し / 無し | `next/link` | 無し |
| `ae-expression` | `tool-ae-expression` | `cd136e25` | main | pnpm | **無し** | **無し** | 無し / 無し | `next/link` | `ToolWrapper` |
| `mic-level` | `tool-mic-level` | `5df7ac64` | main | pnpm | **無し** | test / lint / format / type-check のみ | 無し / 無し | `next/link` | 無し |

13 件すべてが `package.json` の `exports` で `./src/index.ts`（mic-level のみ
`./src/index.tsx`）を library として公開しているだけで、
`vite.config` / `index.html` / `src/main.tsx` / `build` script を持たない。

### 4.2 実行時面（外部 origin・browser API）

| slug | 実行時に触る外部 origin | browser API | 配信経路上の要注意点 |
| --- | --- | --- | --- |
| `prototype` | `fonts.googleapis.com` / `fonts.gstatic.com` / `script.google.com` / `use.typekit.net`（manifest の `delivery.privacy.third_party_origins` に宣言済） | clipboard / localStorage | 同意 band が要る（宣言済）。`safeStorage` は sandbox 除去で localStorage 保存に変わる（release note 対象） |
| `readmark` | 無し（manifest の宣言も空） | IndexedDB（dexie） | sandbox を外さないと opaque origin で IndexedDB が拒否される（#786 の実測） |
| `text-counter` | 無し | clipboard（async Clipboard） | clipboard は origin 依存。opaque origin では `navigator.clipboard` が拒否されるため fallback が必要 |
| `color-palette` | 無し | clipboard / localStorage | 同上。upstream PR #6 が fallback 済み（§9） |
| `sequential-png-preview` | 無し | canvas 2d / file input / object URL / download | `next/image` の除去が必要。download は `allow-downloads` の要否が §8 |
| `svg2tsx` | `example.com` は**サンプル文字列**（通信ではない） | clipboard / download | 通信は無いため consent は不要 |
| `business-mail-block` | 無し | clipboard / drag & drop / download | `@hello-pangea/dnd` を使う。host 相対 import（`ToolWrapper`）の置換が必要 |
| `code-type-p5` | 無し | p5.js の canvas / ZIP 書き出し / download | p5 は依存で canvas を作る（`src/hooks/useP5Lifecycle.ts` が `import p5 from "p5"`） |
| `fillgen` | 無し | clipboard / download / `document.createElement` 多用 | `next/link` の除去。DOM 直接操作は StrictMode の二重 mount を検証する |
| `qr-generator` | 無し | canvas → PNG download | 依存が小さく host 相対 import なし。最も素直 |
| `pomodoro` | **`www.youtube.com`（埋込プレイヤー）** / `via.placeholder.com` | **Web Notifications** / vibrate / localStorage / sessionStorage | 第三者 origin の宣言と同意が要る（`embed-privacy.ts`）。Notifications は origin 依存が大きい（§8） |
| `history-quiz` | 無し（**`/history-quiz.html` を同一 origin から fetch**） | DOM 直接操作 | **コンテンツが host 側に無い**（§5.11） |
| `pi-game` | 無し | fullscreen / keyboard | `next/link` の除去。default branch が `develop`（pin bump 時に注意） |
| `ae-expression` | 無し | clipboard / download / localStorage | `next/link` と host 相対 import（`ToolWrapper`）の除去が必要 |
| `mic-level` | `obsproject.com` は**リンク**（通信ではない） | **`getUserMedia`（microphone）** / Web Audio | 権限条件。ADR-0020 §4.5.2 の 7 条件を満たすまで「利用可能」と宣言しない |

## 5. Tool ごとの「利用可能にするまでの差分・終了条件・検証方法」

各項の形式: **現在** / **足りないもの** / **終了条件** / **検証方法** /
**追跡 Issue** / **担当**。

### 5.1 `prototype`（利用可）

- **現在**: `same_origin_static`（`/tools/prototype/app`）。`delivery.iframe` は
  `sandbox: "allow-scripts"` / `referrer_policy: "no-referrer"`、
  `third_party_origins` に 4 origin を宣言。同意 band あり。
- **足りないもの**: ADR-0020 の sandbox 除去（#825）。その後の再検証
  （同意 band → frame 描画 → 宣言 origin だけへの通信、1440 / 390 の WebP）。
  `safeStorage` の挙動変化（毎回 no-op → localStorage 保存）は release note。
- **終了条件**: #825 の着地後、`/tools/prototype` の frame に `sandbox` が無く、
  同意前は外部 origin への要求 0 件、同意後は宣言された 4 origin だけが
  観測される。
- **検証方法**: ADR-0020 §5.2 の 1–8 / §3.6 (a)–(h) の実測。WebP 証跡を
  `docs/verification/tools/` に置く。
- **追跡 Issue**: **#825**（配信変更）／ **#785**（一覧表示）。
- **担当**: agent（host 側 PR ＋ 証跡）。公開日本語 copy の変更が要る場合は
  owner レビュー対象。

### 5.2 `readmark`（利用可）

- **現在**: `same_origin_static`（`/tools/readmark/app`）。`sandbox:
  "allow-scripts"` のため opaque origin になり、**IndexedDB が拒否されて
  「読み込み中…」のまま止まる**（#786 の実測）。
- **足りないもの**: (1) ADR-0020 の sandbox 除去（#825）。(2) **import が
  pinned build では無効** — ADR-0020 §7 が「upstream main への pin bump は
  別 ticket」と明記しており、上流に import の修正が入るまで、
  readmark は「読む」機能を持たない。
- **終了条件**: #825 の着地後、`/tools/readmark` が
  「ライブラリは空です。上のボタンから文書を追加してください。」まで到達する
  こと（#786 の受け入れ）。import の有効化は upstream の bump が前提。
- **検証方法**: production 相当で frame 内の `indexedDB.open()` が成功する
  こと（`SecurityError` でないこと）を実測し、画面の文言を記録する。
- **追跡 Issue**: **#786**（sandbox 起因の停止 → #825 の着地後に close）。
- **担当**: agent（host 側 PR ＋ 実測）。upstream の bump は owner との
  調整。

### 5.3 `text-counter`（`host_disabled`）

- **現在**: library のみ（`exports: ./src/index.ts`）。`build` script 無し。
  `js-tiktoken` を依存に持ち、`RawDOMContainer` を host から import している。
  **upstream PR #6 が Draft で開いている**（§9）。
- **足りないもの**: §3 の recipe 1–7。upstream PR #6 は recipe の 1–5 と 7 を
  含むが、**Draft** であり、standalone face が tokenizer を含まない判断が
  owner 確認待ち（PR 本文）。
- **終了条件**: upstream PR #6 が merge され、merge SHA を pin して host 側で
  `same_origin_static` にし、Tokenizer パネルを出す場合は upstream 側の判断が
  確定していること。
- **検証方法**: build 成功（`dist/index.html` ＋ JS 生成）、`/tools/text-counter`
  で文字数・単語数・行数・段落数・UTF-8 バイト数が表示されること、clipboard
  コピーが origin 依存で失敗しても fallback があること。
- **追跡 Issue**: **#353**。
- **担当**: agent（upstream PR の follow-up ＋ host PR）。**upstream merge は
  owner 判断**。

### 5.4 `color-palette`（`host_disabled`）

- **現在**: library のみ。react のみに依存（runtime 依存最小）。外部 origin 無し。
  `RawDOMContainer` を host から import。**pilot である**（§0.1 / §7）。
  upstream 側では standalone Vite build の追加が**進行中**（別 worker が
  `rebuildup/tool-color-palette` で作業中）。2026-11-02 時点の upstream PR #6
  は Ready だが、**pilot 実装と重複するため二本立てにしない**（§9）。
- **足りないもの**: §3 の recipe 1–7（`base: './'` を含む。pilot 実装が
  そのまま入る）。clipboard は origin 依存のため fallback が必要。
- **終了条件**: upstream の pilot 実装が merge され、merge SHA を pin して
  host PR で `same_origin_static` にすること。**この 1 件で共通 recipe が
  確定する**ため、以降の 12 件は横展開になる（§7）。
- **検証方法**: 5 色生成・コピー・保存が frame 内で動作し、console error が
  無いこと（§9 の実測条件）。host 側は `scripts/rewrite-asset-paths.mjs` の
  乾物実行で `/tools/color-palette/app/assets/…` への書き換えを確認する。
- **追跡 Issue**: **#770**。
- **担当**: agent（upstream PR は起票済、merge は owner 判断）。

### 5.5 `sequential-png-preview`（`host_disabled`）

- **現在**: library のみ。`next/image` を import（`src/**` で 1 箇所）、
  `RawDOMContainer` を host から import。canvas 2d と object URL を使う。
- **足りないもの**: §3 の recipe 1–7 + `next/image` の除去（Next の画像最適化
  は standalone に存在しない。`<img>` へ置換する）。
- **終了条件**: upstream に build path があり、`next/*` import が 0 件に
  なっており、host 側が pin を bump して公開できていること。
- **検証方法**: 連番 PNG 複数枚の読み込み → 再生 → GIF / MP4 書き出しが
  frame 内で完了すること。download が `allow-downloads` 無しで失敗しないこと
  （§8）。
- **追跡 Issue**: **#357**。
- **担当**: agent（upstream PR + host PR）／ merge は owner。

### 5.6 `svg2tsx`（`host_disabled`）

- **現在**: library のみ。react のみに依存。`RawDOMContainer` を host から
  import。`example.com` はサンプル文字列で通信しない。
- **足りないもの**: §3 の recipe 1–7。
- **終了条件**: upstream に build path があり、host 相対 import が 0 件。
- **検証方法**: SVG を貼ると TSX が出力され、色の変数化 / path 最適化 /
  不要属性削除の切替が効き、出力を clipboard へコピーできること。
- **追跡 Issue**: **#356**。
- **担当**: agent（upstream PR + host PR）／ merge は owner。

### 5.7 `business-mail-block`（`host_disabled`）

- **現在**: library のみ。`bun` を使う manifest（`bun.lock` 有）。runtime 依存は
  `@hello-pangea/dnd` と `lucide-react`。`ToolWrapper` を host から import。
  `biome` / `type-check` script のみを持ち、build script は無い。
- **足りないもの**: §3 の recipe 1–7。**package manager の一致**が既に
  manifest 側（bun）と一致している点は他より整っている。
- **終了条件**: upstream に build path があり、host 相対 import が 0 件、
  ドラッグ＆ドロップ（drag & drop）が standalone で動くこと。
- **検証方法**: ブロックの並べ替え → 複製 → 署名付きメール生成 → コピーまで
  一連が frame 内で通ること。
- **追跡 Issue**: **#771**。
- **担当**: agent（upstream PR + host PR）／ merge は owner。

### 5.8 `code-type-p5`（`host_disabled`）

- **現在**: library のみ。`p5` と `jszip` に依存。`RawDOMContainer` を host から
  import。canvas は p5 が生成する。
- **足りないもの**: §3 の recipe 1–7。**p5 は instance mode で使う**必要が
  あり、standalone entry（`src/main.tsx`）から `new p5(sketch, node)` を
  呼ぶ形になる（React component と p5 の life cycle の接続）。
- **終了条件**: upstream に build path があり、p5 の life cycle が
  standalone entry から 1 回だけ起動・停止されること（StrictMode の二重
  mount で 2 回起動しないこと）。
- **検証方法**: コード入力 → アニメーション描画 → PNG 連番の ZIP 書き出しまで
  が frame 内で通ること。
- **追跡 Issue**: **#361**。
- **担当**: agent（upstream PR + host PR）／ merge は owner。

### 5.9 `fillgen`（`host_disabled`）

- **現在**: library のみ。lockfile 無し。`next/link` を import。
  `document.createElement` を多用（`src/components/utils.ts` /
  `renderers.ts` / `useQuizSectionHandlers.ts`）。
- **足りないもの**: §3 の recipe 1–7 + `next/link` の除去（`<a>` へ置換）。
- **終了条件**: upstream に build path と lockfile があり、DOM 直接操作が
  StrictMode の二重 mount で重複しないこと。
- **検証方法**: Markdown 風テキスト → 穴埋め問題ページの生成 → HTML / React
  コード書き出しまでが frame 内で通ること。
- **追跡 Issue**: **#359**。
- **担当**: agent（upstream PR + host PR）／ merge は owner。

### 5.10 `qr-generator`（`host_disabled`）

- **現在**: library のみ。lockfile 無し。`next/*` import 無し、host 相対
  import 無し。依存は `qrcode` / `qrcode.react` のみ（最小）。
- **足りないもの**: §3 の recipe 1–7。**他と比べる共通差分が最小**（import 除去が
  不要）。
- **終了条件**: upstream に build path と lockfile があること。
- **検証方法**: テキスト / URL から QR を生成し、色とパラメータを調整でき、
  PNG / SVG で保存できること。
- **追跡 Issue**: **#355**。
- **担当**: agent（upstream PR + host PR）／ merge は owner。

### 5.11 `history-quiz`（`host_disabled`）

- **現在**: library のみ。`src/` は 2 ファイル（`HistoryQuizApp.tsx` /
  `index.ts`）と極小。実行時に **同一 origin の `/history-quiz.html` を
  fetch** する（`src/HistoryQuizApp.tsx:99`）。
- **足りないもの**: (1) §3 の recipe 1–7。(2) **quiz 本体のコンテンツが
  Tool repo に無い**。`/history-quiz.html` は旧サイト
  `my-web-2025/public/` 側にあり、Tool repo には無い。
- **終了条件**: (1) upstream に build path があること。(2) **コンテンツの
  移設の可否が owner 側で決まっていること**（所有権・著作権の判断）。移設が
  不可なら、Tool repo 内で同等のクイズ定義を 1 から作る（別の ticket）。
- **検証方法**: 設問の入力 → ヒント → 正解表示までが frame 内で通ること。
  コンテンツ未移設のままでは fetch が 404 になり**動作しない**。
- **追跡 Issue**: **#772**。
- **担当**: agent（upstream PR）／ **コンテンツ移設の可否は owner 判断**
  （§9 の未決 1）。merge は owner。

### 5.12 `pomodoro`（`host_disabled`）

- **現在**: library のみ。lockfile 無し。`next/image` を import。
  **`www.youtube.com` の埋込プレイヤー**と `via.placeholder.com` を参照。
  **Web Notifications** を使う。`localStorage` / `sessionStorage` を使う。
- **足りないもの**: §3 の recipe 1–7 + `next/image` の除去 +
  **第三者 origin の宣言と同意**（`src/tools/embed-privacy.ts` の
  `third_party_origins` / `click_to_load`）+ Notifications の扱い（§8）。
- **終了条件**: upstream に build path があり、`delivery.privacy` に
  `www.youtube.com`（必要なら `via.placeholder.com`）の宣言が載り、同意
  band が出る状態であること。Notifications は origin 依存があるため、
  **採用するか否か**を Tool 側で決める（host 側では解決しない）。
- **検証方法**: タイマーの開始 / 休止 / サイクルが frame 内で進むこと、
  同意前に `www.youtube.com` への要求が 0 件であること、同意後にその origin
  だけが観測されること（ADR-0020 §3.6 (g)）。
- **追跡 Issue**: **#358**。
- **担当**: agent（upstream PR + host PR）／ merge は owner。

### 5.13 `pi-game`（`host_disabled`）

- **現在**: library のみ。lockfile 無し。`next/link` を import。
  **default branch が `develop`**（他 12 件は `main`）。
- **足りないもの**: §3 の recipe 1–7 + `next/link` の除去。pin bump の時は
  **default branch が `develop` である**ことに注意（pin の取り違えを
  避ける）。
- **終了条件**: upstream に build path があること。fullscreen が
  `allowfullscreen` 無しで失敗しないこと（§8）。
- **検証方法**: 円周率の桁入力 → 記憶ゲーム → fullscreen 表示までが frame
  内で通ること。
- **追跡 Issue**: **#354**。
- **担当**: agent（upstream PR + host PR）／ merge は owner。

### 5.14 `ae-expression`（`host_disabled`）

- **現在**: library のみ。lockfile 無し。`next/link` と host 相対 import
  （`ToolWrapper`）を使う。`lucide-react` に依存。clipboard / download /
  localStorage を使う。
- **足りないもの**: §3 の recipe 1–7 + `next/link` の除去 + `ToolWrapper` の
  置換。
- **終了条件**: upstream に build path があり、host 相対 import が 0 件。
- **検証方法**: 式一覧の閲覧 → パラメータ確認 → コピーが frame 内で通る
  こと。
- **追跡 Issue**: **#773**。
- **担当**: agent（upstream PR + host PR）／ merge は owner。

### 5.15 `mic-level`（`host_disabled` → `same_origin_static`）

- **現在（2026-11-02 実測）**: upstream は standalone Vite build を merge 済み
  （`9506e461`）。host 側も `same_origin_static` へ配線済み
  （submodule / manifest / artifact / preview）。**ただし ADR-0020 §4.5.2 の
  7 条件のうち 3 条件が未達**で、原因は 1 つに絞れた: `delivery.iframe` に
  残っている `sandbox="allow-scripts"`。
  - 実測（ローカル preview / Chromium）: frame 内 `window.origin === "null"`
    （opaque origin）→ `getUserMedia` が `SecurityError` で reject
    （console: `Permissions policy violation: microphone is not allowed in
    this document.`）。同じ src / 同じ `allow="microphone"` / 同じ応答ヘッダの
    frame から sandbox 属性だけを取り除くと `getUserMedia` は**成功**する。
  - 達している条件: #2（破壊しない fallback / 未処理例外 0 件）、
    #3（容器側 `microphone=(self "<配信 origin>")`）、
    #4（文書側 `microphone=(self "https://rebuildup.dev")`）、
    #5（`<iframe allow="microphone">`）。
  - 未達の条件: #1（許可経路）/ #6（sandbox 不在）/ #7（frame origin）。
  - 証跡: [`mic-level-host-activation.md`](mic-level-host-activation.md)。
- **足りないもの**: ADR-0020 §2.1（D1: `same_origin_static` は sandbox なしで
  配信する）の**実装**。`release-0-8-1` のコードはまだ
  `manifest.schema.json` が `iframe.sandbox` を必須とし、
  `src/tools/embed-policy.ts` が token 1 個以上を要求し、
  `src/routes/tools.$slug.tsx` が常に `sandbox` 属性を描画する。D1 の
  実装は #825 の担当であり、稼働中の 7 Tool の frame origin と storage
  挙動を同時に変えるため、mic-level の配線 PR には含めていない。
  D1 が land すると #1 / #6 / #7 は到達する見込み（上記 AB 実測が、その
  形での到達済みの証拠）。
- **終了条件**: ADR-0020 §4.5.2 の **7 条件すべて**を実測すること
  （許可経路 / 拒否経路 / 容器側の Permissions-Policy / 文書側の
  Permissions-Policy / `allow="microphone"` / sandbox 不在 / frame origin）。
- **検証方法**: ADR-0020 §4.5.2 の表の測定方法（Playwright での権限許可 /
  拒否の両方、応答ヘッダの実測、配信 HTML の実測）。証跡は
  `docs/verification/tools/`。
- **追跡 Issue**: **#360**（本_tool の卒業）／ **#598**（旧 owner gate。sandbox
  除去の決定により前提ごと解消した論点）／ **#825**（D1 の実装。#1 / #6 / #7
  の未達の前提）。
- **担当**: agent（upstream PR + host PR）／ merge は owner。

## 6. 実行順と担当（決定）

**決定の根拠**: (a) 外部 origin が無い、(b) 権限付与が必要な API が無い、
(c) `next/*` import が無い、(d) host 相対 import が無い、(e) 依存が小さい、
(f) upstream の PR が既に進んでいる、の順で評価した。**owner への提示を
待たずに本 repository が順序を決める**（Issue #769 決定 5）。

| 順 | slug | 追跡 Issue | 担当 | 前提 / 備考 |
| --- | --- | --- | --- | --- |
| 1 | `color-palette` | #770 | agent（upstream pilot 実装 → host PR）／ **upstream merge は owner** | **owner 指定の pilot**（§0.1）。上流の standalone 実装が進行中。**この 1 件で共通 recipe（§3）を確定**し、以降を横展開する |
| 2 | `text-counter` | #353 | agent（upstream PR #6 は Draft → host PR）／ merge は owner | 1 件の recipe がそのまま横展開できる |
| 3 | `qr-generator` | #355 | agent（upstream PR + host PR）／ merge は owner | import 除去が不要。依存最小 |
| 4 | `svg2tsx` | #356 | agent（upstream PR + host PR）／ merge は owner | clipboard のみ |
| 5 | `sequential-png-preview` | #357 | agent（upstream PR + host PR）／ merge は owner | `next/image` 除去 + download 判断 |
| 6 | `fillgen` | #359 | agent（upstream PR + host PR）／ merge は owner | lockfile 新規 + DOM 直接操作の検証 |
| 7 | `business-mail-block` | #771 | agent（upstream PR + host PR）／ merge は owner | bun 整合済 |
| 8 | `pi-game` | #354 | agent（upstream PR + host PR）／ merge は owner | default branch が `develop`。注意 |
| 9 | `ae-expression` | #773 | agent（upstream PR + host PR）／ merge は owner | `next/link` + `ToolWrapper` |
| 10 | `code-type-p5` | #361 | agent（upstream PR + host PR）／ merge は owner | p5 の life cycle 接続 |
| 11 | `pomodoro` | #358 | agent（upstream PR + host PR）／ merge は owner | 第三者 origin + Notifications の判断が先 |
| 12 | `history-quiz` | #772 | agent（upstream PR）／ **コンテンツ移設は owner 判断** | 移設不可なら Tool repo でquiz を新規作成（別 ticket） |
| 13 | `mic-level` | #360 / #598 | agent（upstream PR + host PR）／ merge は owner | §4.5.2 の 7 条件を満たすまで公開しない |

利用可能 2 件の残作業:

| slug | 追跡 Issue | 担当 | 備考 |
| --- | --- | --- | --- |
| `prototype` | #825 / #785 | agent | sandbox 除去後の再検証と WebP 証跡 |
| `readmark` | #786 | agent | sandbox 除去後の「ライブラリは空です」到達確認。import は upstream bump が前提 |

**共通前提**: 13 件すべての host PR は **#825（ADR-0020 の実装）の着地後**に
merge する。現状 `src/tools/embed-policy.ts:510-517` は
`same_origin_static` にも `sandbox` を**必須**としている（`embed.sandbox.missing`
が fail closed）ため、sandbox 無しで卒業した Tool は runtime で frame を
描画できない。順序としては **upstream merge → host PR（ submodule 追加 +
manifest 化 + artifact inventory + 証跡）→ #825 の policy 変更 → 公開**が
自然である（#825 の PR 側で schema と policy を先に直す案もあり、どちらを
先にしても「sandbox 必須の状態で公開」しないことが条件）。

## 7. 最初の end-to-end 候補（pilot: `color-palette`）

### pilot: `color-palette`（Issue #770）— **owner 指定**（§0.1）

- 外部 origin 無し、`next/*` import 無し、runtime 依存は react のみ。
- host 相対 import は 1 箇所（`RawDOMContainer`）のみ。
- 権限 API は clipboard のみ。opaque origin では `navigator.clipboard` が
  拒否されるため fallback が必要。
- **上流の standalone Vite build 実装が進行中**（別 worker が
  `rebuildup/tool-color-palette` で作業中、2026-11-02 時点）。owner が
  指定した recipe（`index.html` + `src/main.tsx` + `vite.config.ts` の
  `base: './'` + build script）を**この 1 件で確定**し、残り 12 件を横展開
  する。
- 目標の中身は owner の指定どおり **静的コンテンツでよい**（§0.1）。

**pilot の host PR が通った後に残りを横展開する。** 横展開で変えるのは
recipe の 3 点（recipe 1–3 と 5–7 の個別差分）だけであり、**recipe 自体を
変えない**。

### 第 2 候補: `text-counter`（Issue #353）

- `color-palette` と同じ構造（react のみ + `RawDOMContainer` + clipboard）。
  `js-tiktoken` を追加で持つ。
- 2026-11-02 時点の upstream PR #6 は **Draft** であり、standalone face の
  範囲（tokenizer を含めるか）が owner 確認待ち。**pilot の host PR が通った
  後に着手**する。

### 保留

`history-quiz`（#772）は構造が最も単純だが、quiz コンテンツが Tool repo に
無い（§5.11）。`pomodoro`（#358）は第三者 origin と Notifications の判断が
先行し、`mic-level`（#360）は権限条件の 7 項目（§5.15）の実測が先行する。

## 8. host 側で残る論点（Tool 実装後に判断が要るもの）

| 論点 | 該当 Tool | 必要な host 側判断 |
| --- | --- | --- |
| クリップボード書き込み | `text-counter`, `color-palette`, `svg2tsx`, `ae-expression`, `fillgen`, `business-mail-block` | `iframe.allow` に `clipboard-write` を付けるか、Tool 側で fallback（`execCommand` / 手動コピー UI）にするか。**upstream PR #6 は fallback 側で解いている**（§9） |
| ファイルダウンロード | `qr-generator`, `code-type-p5`, `sequential-png-preview`, `svg2tsx`, `fillgen`, `business-mail-block` | `allow-downloads` を追加するか（`sandbox_rationale` が必要） |
| 全画面 | `pi-game` | `allowfullscreen` / `allow-presentation` の扱い |
| Web Notifications | `pomodoro` | opaque origin の sandbox frame では許可要求が成立しない。ADR-0020 の採用後は same-origin になるため**要求は通る**が、通知の可否は Tool 側の設計判断 |
| 第三者の埋込 | `pomodoro` | `www.youtube.com` の実行時参照。`delivery.privacy` の宣言と consent 表示が必要 |
| mic | `mic-level` | **§4.5（ADR-0020）で決着済み**。host 側の許可は実装済みで、残るのは 7 条件の実測のみ |

## 9. upstream PR の実測（2026-11-02）

### `tool-color-palette` PR #6（**Ready / open**）

- upstream Issue: rebuildup/tool-color-palette#5（open）
- upstream PR: rebuildup/tool-color-palette#6（Ready）。head
  `ab049e618641e82d47e417e92b5cf67deac2b760`。**merge は owner 判断**。
- 追加されたもの（2026-11-01 実測）: `vite.config.ts` / `index.html` /
  `src/main.tsx` / `tsconfig.json`、`build` ほか script、devDependencies
  （Vite 7.3.x / plugin-react 5.2.x / TypeScript 5.9.x）、host import を
  置き換える `AppFrame`、opaque origin 向けの storage guard と copy fallback。
- 実測（2026-11-01）: `bun install --frozen-lockfile`（変更なし）、
  `bun run type-check`（exit 0）、`bun run build`（`dist/index.html` ＋
  209.81 kB JS）。`<iframe sandbox="allow-scripts">` 内で初期表示・5 色生成・
  コピー・保存（in-memory）が動作し、console error なし。通常 origin では
  reload 後も保存が復元される。
- host の `scripts/rewrite-asset-paths.mjs` を乾物実行し、
  `/tools/color-palette/app/assets/...` への書き換えと `crossorigin` の
  除去を確認した。
- **2026-11-02 時点の追加実測**: PR #6 は**まだ open**（merge されていない）。
  repo の default branch は `main`、最新 commit は `9c3b9e5c`
  （2026-09-27）。default branch 側に `vite.config` / `index.html` は**無い**
  ので、pin bump だけでは build できない。
- **2026-11-02 時点の指示**: `color-palette` は **pilot** に指定され、
  upstream の standalone Vite build 実装が**別 worker により進行中**である
  （§0.1）。本 PR #6 と **二本立てにしない** — pilot 実装（owner 指定の
  recipe: `index.html` + `src/main.tsx` + `vite.config.ts` の `base: './'` +
  build script）を正とし、PR #6 は upstream 側で整理される。host 側の作業
  （submodule 追加 / manifest 化 / artifact inventory / 証跡）は **pilot の
  merge SHA** を待って 1 本で入れる。

### `tool-text-counter` PR #6（**Draft / open**、2026-11-02 に新規確認）

- upstream PR: rebuildup/tool-text-counter#6「feat: ホスト埋め込み用の standalone
  build を追加する」。**Draft**、head `4475c4627515…`、作成 2026-10-28。
- 変更ファイル: `index.html` / `src/main.tsx` / `vite.config.ts` /
  `tsconfig.json` / `src/components/RawDOMContainer.tsx`（host 相対 import の
  置換）/ `package.json` / `bun.lock` / `README.md` ほか。
- PR 本文が「standalone face が tokenizer を含まない理由（owner 確認が要る
  判断）」を明示している。**この判断が固まるまで host PR は始めない。**
- repo の default branch は `main`、最新 commit は `42b6643c`（2026-09-27）。
  default branch 側に build path は無い。

### 残り 11 repo

- `tool-sequential-png-preview`, `tool-svg2tsx`, `tool-business-mail-block`,
  `tool-code-type-p5`, `tool-qr-generator`, `tool-pi-game`,
  `tool-ae-expression`, `tool-mic-level` には **build path 用の open PR が
  無い**。
- `tool-fillgen` の open PR #3 / `tool-pomodoro` の open PR #4・#6 /
  `tool-history-quiz` の open PR #2・#4 は **build path と無関係**
  （initial setup / CI 保護 / スタイル復元）。
- default branch の最新 commit（2026-11-02 時点）:
  `text-counter` `42b6643c` / `color-palette` `9c3b9e5c` /
  `sequential-png-preview` `36d1af3e` / `svg2tsx` `d79c198f` /
  `business-mail-block` `904b97f6` / `code-type-p5` `e7b47785` /
  `fillgen` `01d53b84` / `qr-generator` `576f666f` / `pomodoro` `954cfd89` /
  `history-quiz` `72328139` / `pi-game` `da77ee62` /
  `ae-expression` `739ca4a6` / `mic-level` `8bc77be4`。
  **default branch にも build path は無い**ので、pin bump だけでは解決しない。

## 10. 読めなかったもの・測らなかったもの

推測で「対応可能」と書いていないため、**読めなかった / 測らなかった**を
ここに列挙する。

1. **upstream の build を実行していない。** 本書は静的証拠（tarball の
   ファイル、`package.json`、import 検索）だけに基づく。**「build できる」
   「実行時に動く」は未検証**である。実測済みなのは `color-palette` の
   upstream PR #6 のみ（§9、2026-11-01 測定）。
2. **`my-web-2025/public/history-quiz.html` はこのリポジトリに無く実測
   できない。** 2026-11-01 版が記録していた 89,935 bytes という数値は
   2026-11-02 時点では**再検証できていない**（旧サイトのリポジトリを
   今回 clone していない）。`history-quiz` の `src/HistoryQuizApp.tsx:99` が
   同一 origin の `/history-quiz.html` を fetch する、という**コード側の
   事実**のみ確認できる。
3. **production の応答ヘッダを実測していない。** `Permissions-Policy` については
   `public/_headers:183-192` と `src/http/security-headers.ts` の**ソース**を
   読み、既存のテスト（`src/http/security-headers.test.ts`）が宣言している
   値を記録した。実ブラウザでの応答ヘッダ実測は各 Tool の卒業条件
   （§5.15 / ADR-0020 §4.5.2）で行う。
4. **13 repo の submodule は無い。** `external/` に checkout されているのは
   `prototype` と `readmark` の 2 件だけで、残り 13 件は tarball として
   読んだ（submodule 追加は host PR の作業、§6）。
5. **ADR-0020 の実装（#825）は未着地である。** 現状の
   `src/tools/embed-policy.ts:510-517` は `same_origin_static` に `sandbox` を
   必須としているため、**sandbox 無しの配信は現時点でできない**。§6 の
   「共通前提」はこの順序に依存する。
6. **artifact inventory は `unverified` のまま。**
   `quality/tool-artifact-inventory.json` の prototype / readmark 以外は
   license / dependencies / outbound 観測がすべて未検証である。これは
   「問題なし」ではなく「**build して測っていない**」を意味する。各 Tool の
   host PR で build → `pnpm run tools:artifact:update` → 再生成する。
7. **upstream repo の LICENSE は MIT と読める**が、**成果物の license 証拠は
   未取得**である（build が無いため artifact が無い）。

## 11. 再測定手順

```bash
# pinned SHA の tarball を read-only で取得する
gh api repos/rebuildup/<repo>/tarball/<pinned_sha> > /tmp/<slug>.tar.gz
mkdir -p .tmp/<slug> && tar -xzf /tmp/<slug>.tar.gz -C .tmp/<slug> --strip-components=1

# 確認する項目
#   - package.json の scripts / packageManager / dependencies / peerDependencies
#   - vite.config.* / index.html / src/main.tsx の有無
#   - lockfile の種類（bun.lock / pnpm-lock.yaml / 無し）
#   - src/** の next/* import
#   - src/** の host 相対 import（../../../../src/...）
#   - src/** が fetch する host 側ファイル（例: /history-quiz.html）
#   - src/** の http(s):// origin
#   - src/** の browser API（getUserMedia / Notification / clipboard / storage / canvas）

# upstream の 진행状況
gh pr list --repo rebuildup/<repo> --state open --json number,title
gh api repos/rebuildup/<repo>/commits?per_page=1 --jq '.[0].sha'
```

## 12. 関連

- Issue #769（本棚卸しの親・順序と担当の決定）
- ADR-0020（first-party 同一 origin 配信、Accepted、`mic-level` の卒業条件）
- 個別 Issue: #353 #354 #355 #356 #357 #358 #359 #360 #361 / #770 #771 #772 #773
- 配信の共通 Issue: #825（ADR-0020 の実装）/ #786（readmark）/ #785（一覧）
- 旧 owner gate: #598（`mic-level` の `allow-same-origin` 論点 — 解消）
- 契約: ADR-0006（Tool submodule policy）
- embed policy: `src/tools/embed-policy.ts`, `docs/tools/embed-policy.md`
- privacy: `src/tools/embed-privacy.ts`, `docs/tools/embed-privacy.md`
- ライセンス・依存検証: Issue #466, `quality/tool-artifact-inventory.json`
- 公開面の準備中 copy: Issue #836（`disabled_reason` の公開。別 PR）
