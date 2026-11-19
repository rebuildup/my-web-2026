# 名前と handle の対応 — 表示プレビューの検証画像 (#524)

- 対象: `docs/personal/handle-map.md`（参照文書）と `src/personal/handle-map/`（preview データ + component + Storybook story）
- Issue: #524（`feat(identity): 名前・ハンドルの対応を説明する独立表示コンポーネント`）
- 成果物: `docs/verification/identity/handle-map-story.png`
- 状態: **本 Issue で実装・検証済み**。残る未決事項は文書の「未確認（owner 確認待ち）」節

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/personal/handle-map/HandleMap.stories.tsx` の `Default` story（story 自身の `render()` 出力） |
| capture 手段 | `node scripts/capture-handle-map.mjs`（`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → PNG） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの。すなわち実際の `src/styles.css` |
| viewport / DPR | 1440 x 900 / 1（`fullPage` 撮影） |
| 生成物サイズ | 1440 x 2635 px、**440 KB** PNG（budget 1024 KB） |
| 再現性 | **encode 段は決定的、ブラウザ撮影は byte 再現ではない**（プロセス間でも差が出る）。再生成は視覚的に同一であることを目標とする |
| 本番非破壊 | 既定で外部通信なし。local harness build と loopback 配信のみ。deploy / remote binding / secret 値の読み出しは無い |

### なぜ `storybook dev` ではなく harness なのか

`pnpm run build-storybook` はこの repository では manager-only の静的ビルドになる（`@storybook/react-vite` builder がプロジェクトの `vite.config.ts` を merge し、Cloudflare / TanStack Start plugin が preview の出力先を取る。出力に `iframe.html` が無い）。同じ事実を `scripts/capture-error-state-gallery.mjs`（#501）と `scripts/capture-music-connections.mjs`（#525）が記録している。

capture は長-lived な dev server に依存しないため `.tmp/` に Vite harness を生成し、**shipped story module を直接 import** して、story 自身の `render()` が出力するものをレンダリングする。harness が描くものは「コピーした preview」ではなく「shipping されている preview そのもの」なので、capture と Storybook surface は乖離しない。

### なぜ PNG なのか

Issue #524 が成果物の path を `docs/verification/identity/handle-map-story.png` と指定している。この凡例は標準幅で 2635 px の小さな面であり、PNG のまま 440 KB に収まるため、WebP 変換の手順を増やさない。

## 2. 画面が示しているもの

画像は identity legend preview の全ページを撮影したものである。

1. **document title** — `名前と handle の対応 — identity legend`。
2. **文書メタ情報 4 点** — status / 典拠 / 機械検証 / プレビューの path。
3. **凡例（`HandleMap` component）** — 7 つの名前それぞれについて、側面（aspect）・説明・公開リンクをカードで示す:
   - 木村友亮 / Yusuke Kimura（real-name identity）
   - yusuke-kim.com（個人ドメイン）
   - samuido（primary public handle）
   - 361do（stylized / distribution identity）
   - 361do_sleep（用途別 social handle・技術開発側）
   - 361do_design（用途別 social handle・映像デザイン側）
   - rebuildup（development-facing identity）
4. **リンクの規則 / 典拠 / 実装と機械検証 / 未確認（owner 確認待ち）** — 文書と同じ箇条書き。

## 3. 機械で検証した項目

撮影は「asset を作る」だけに留まらず、**描画された DOM を preview データと突き合わせる**。capture が FAIL する条件は以下（描画から読み取った値が preview データと一致しない場合、non-zero exit で artefact は書かれない）。

| 項目 | 判定 | 実測 |
| --- | --- | --- |
| document title | 描画された `<h1>` が `HANDLE_MAP_DOCUMENT.title` と一致 | 1 件一致 |
| 文書メタ情報 | status / source / verification / preview の 4 点が `<header>` の `<ul>` に存在 | 4 件一致 |
| legend entries | `[data-handle-map-entry] h3` の名前が `HANDLE_MAP_ENTRIES[].name` と順序込みで一致 | 7 件一致 |
| 公開リンク | 全 `entry.links[].url` が `<a href>` として存在し、**ページ上のリンク総数が宣言数と一致**（未宣言リンク＝創作リンクは FAIL） | 12 件一致 |
| section 集合と順序 | 描画された `<h2>` の集合と順序が legend 見出し + `HANDLE_MAP_SECTIONS[].heading` と一致 | 5 件一致 |
| note 箇条書き | `[data-notes-list] li` が `sections[].bullets` と一致 | 全件一致 |
| 横スクロール | `scrollWidth <= clientWidth`（WCAG 2.2 SC 1.4.10 Reflow） | 1440 <= 1440 |
| artefact budget | commit した PNG が 1024 KB 以下 | 440 KB |

## 4. 本文との一致（parity gate）

本文 `docs/personal/handle-map.md` と preview データ `src/personal/handle-map/HandleMap.preview.ts` の一致は `scripts/check-handle-map-preview-parity.test.mjs` が検証する。

- `##` 見出しの集合と順序が一致する。
- 凡例の各 entry が `名前:` / `側面:` / `説明:` / `公開リンク:` の箇条書きとして一致する（`handleMapEntryBullets` が唯一の生成元）。
- 各 section の箇条書きが一致する。
- **リンク規則の機械化**: 全 `entry.links[].url` が `src/about/data.ts` / `src/about/links.ts` / `src/about/career.ts` の記録に存在する URL であること（path 境界を意識した prefix 比較）。記録に無い URL を足すと FAIL する — これが「非公開アカウントをリンクとして創作しない」の機械的な形である。
- 全 `entry.name` が `docs/personal/domain.md` / `docs/personal/owner.md` / `src/about/data.ts` / `src/about/links.ts` のいずれかに存在すること。

本 capture は parity gate の別系統である。parity gate は「本文と preview データの一致」を、capture は「preview データと **描画された DOM** の一致」を見る。

## 5. 採用 / 保留の判断

- **採用**: `docs/personal/domain.md` §1 と `docs/personal/owner.md` が canonical とする名前と側面の対応。`src/about/**` が公開する URL のみをリンクに使う規則。表示位置を固定しない単体 component + Storybook preview（route mount は本 Issue の範囲外）。
- **保留**: Miro board の付箋本文由来の情報（アクセス不可）。yusuke-kim.com の現在の公開状態。凡例を置く公開 surface の選定。英日以外の locale。
