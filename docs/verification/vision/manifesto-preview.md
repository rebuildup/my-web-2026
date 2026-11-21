# なぜ作るのか — 記事案 / LP 案の表示プレビュー検証画像 (#535)

- 対象: `src/personal/manifesto/`（preview データ + Storybook stories）
- Issue: #535（`docs(vision): 制作哲学を公開できる編集記事の一画面として試作`）
- 成果物:
  - `docs/verification/vision/manifesto-article.png`（記事案・広幅 1440px）
  - `docs/verification/vision/manifesto-article-narrow.png`（記事案・狭幅 480px）
  - `docs/verification/vision/manifesto-landing.png`（LP 案・広幅 1440px）
  - `docs/verification/vision/manifesto-landing-narrow.png`（LP 案・狭幅 480px）
- 状態: **本 Issue で実装・検証済み**。残る未決事項は §7 に列挙

## 1. 何を比較したか

Issue #535 は「なぜ作るのか（制作哲学 / manifesto）」を、**標語集ではなく実在する記録を材料にした一画面の提示**として試す Issue である。同じデータを 2 つの容れ物に入れて比較する:

- **記事案（Article）** — 読む順序を持つ文書型。kicker → 題 → 2 つの問い → 材料 → 典拠 → 奥付。
- **LP 案（Landing）** — 1 つの主張と行動導線を持つ landing 型。hero（題 + 1 文 + CTA 2 本）→ 問いのカード 2 枚 → 材料と典拠の strip → 奥付。

両案とも `src/personal/manifesto/Manifesto.preview.ts` の**同一データ**を描く。したがって画面に見える差はすべて容れ物の差であり、内容の差ではない — これが本 preview の実験条件である。

### 2 つの問い（独立した問いとして保持）

Issue の完了条件「Miro の少なくとも 2 価値を独立の問いとして残す」を、データ構造と DOM の両方で担保する。各問いは固有の `data-manifesto-question` を持ち、`miroAxis` に Issue が引用した見出し語をそのまま保持する。

1. **「根本的にいいもの」とは何か** — 哲学 > 根本的にいいものを作る > 意味のあるもの / 最適な技術スタック
   - 問い: 技術的に新しいことと、意味のあることは同じではない。では「根本的にいいもの」を、判断の記録からどう見分けるか。
2. **「作りたいもの」と「欲しいもの」は同じか** — 哲学 > 自分の作りたいもの / 自分の欲しいもの
   - 問い: 作りたいものと、欲しいもの（必要としているもの）は別に存在する。作品ごとの制作動機を、記録の上でどう区別するか。

2 つの問いは統合しない。それぞれの答えは未決であり、本 preview が比較するのは答えではなく容れ物である。

### 奥付（両案の末尾に同一文で出る注意書き）

- 2 つの問いは独立した問いとして残す。1 つの標語に潰さない（Issue #535 の完了条件）。
- 材料はすべて公開済みの記録（ADR / seed / canonical doc）に限定し、未公開の作品・実績・個人情報は含めない。
- 各問いの答えは確定していない。ここで比較するのは「答え」ではなく「容れ物」（記事か LP か）である。
- 公開 route への接続・サイト上の位置・正式公開は owner 決定であり、本 preview の範囲外。

### 材料（公開済みの記録のみ）

- **URL slug の判断 — 正規化ではなく拒否** — 「5 µm tolerance」と「5 μm tolerance」が同じ slug に潰れる測定を受け、導出ではなく拒否で意味を守る設計に変えた。
- **my-web-2026 の再構築 — 境界を引き直した基盤** — 旧サイトが「何でも 1 site に乗せる実験」になっていたため、obligation ごとに境界を引き直して基盤を再構築した。

### 典拠（画面が参照する記録 — parity test が実在を検査）

| label | path |
| --- | --- |
| ADR-0017 — Unicode 正規化と URL slug の分離 | `docs/adr/ADR-0017-unicode-normalization-and-url-slug-separation.md` |
| src/i18n/slug-identity.ts | `src/i18n/slug-identity.ts` |
| docs/personal/growth-through-making.md §6 | `docs/personal/growth-through-making.md` |
| src/portfolio/seed.ts | `src/portfolio/seed.ts` |
| docs/personal/principles.md | `docs/personal/principles.md` |
| scripts/check-architecture.mjs | `scripts/check-architecture.mjs` |

### 公開リンク（画面が出してよい URL はこの 2 件だけ）

- https://github.com/rebuildup/my-web-2026
- https://rebuildup.dev/portfolio

## 2. 撮影条件

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/personal/manifesto/Manifesto.stories.tsx` の `Article` / `Landing` story（story 自身の `render()` 出力） |
| capture 手段 | `node scripts/capture-manifesto.mjs`（`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → PNG） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの。すなわち実際の `src/styles.css` |
| viewport / DPR | 広幅 1440 x 900 / 狭幅 480 x 900、deviceScaleFactor 1（`fullPage` 撮影） |
| 再現性 | encode 段は決定的、ブラウザ撮影は byte 再現ではない。再生成は視覚的に同一であることを目標とする |
| 本番非破壊 | 既定で外部通信なし。local harness build と loopback 配信のみ。deploy / remote binding / secret 値の読み出しは無い |

### なぜ `storybook dev` ではなく harness なのか

`pnpm run build-storybook` はこの repository では manager-only の静的ビルドになる（`@storybook/react-vite` builder がプロジェクトの `vite.config.ts` を merge し、Cloudflare / TanStack Start plugin が preview の出力先を取る。出力に `iframe.html` が無い）。同じ事実を `scripts/capture-error-state-gallery.mjs`（#501）と `scripts/capture-handle-map.mjs`（#524）が記録している。

capture は長-lived な dev server に依存しないため `.tmp/` に Vite harness を生成し、**shipped story module を直接 import** して、その story が持つ `render()` 出力をレンダリングする。harness が描くものは「コピーした preview」ではなく「shipping されている preview そのもの」なので、capture と Storybook surface は乖離しない。

## 3. 機械で検証した項目

撮影は「asset を作る」だけに留まらず、**描画された DOM を preview データと突き合わせる**。capture が fail する条件は以下（1 つでも欠ければ非 zero で終了し、artefact は書かれない）。4 capture すべてに同じ検査を適用する。

| 項目 | 判定 |
| --- | --- |
| document title | 描画された `<h1>` が `MANIFESTO_DOCUMENT.title`（なぜ作るのか）と一致 |
| variant 識別 | root の `data-manifesto-variant` が capture 対象の variant（article / landing）と一致 — 誤った story を撮った場合に検出 |
| document metadata | status / source / verification / document の 4 項目が `<header>` の `<dl>` に存在 |
| 独立した問い | `[data-manifesto-question]` ごとに heading + question が `MANIFESTO_QUESTIONS` と順序込みで一致 — 問いの統合・脱落はここで fail |
| Miro 引用 | 各 `miroAxis` が描画内に verbatim で存在（article は `miro:` 接頭辞つき） |
| 典拠 path | 全 `MANIFESTO_SOURCES[].path` と evidence の参照先 path が body text に存在 |
| 公開リンク | `<a href>` の**一意集合**が `MANIFESTO_LINKS` と一致。未宣言 URL（創作リンク）は fail。LP hero の CTA は同一 URL を 2 度描くが、集合比較なので新規リンク扱いしない |
| 材料 | `MANIFESTO_MATERIALS[].label` が body text に存在 |
| 奥付 | `[data-notes-list] li` が `MANIFESTO_NOTES` と一致（件数も一致） |
| 横スクロール | `scrollWidth <= clientWidth`（WCAG 2.2 SC 1.4.10 Reflow）。狭幅 480px を含む全 capture で確認 |
| artefact budget | commit した PNG が各 1024 KB 以下 |

## 4. 狭幅・広幅の比較結果

| capture | 幅 | 結果 |
| --- | --- | --- |
| manifesto-article.png | 1440px | 問い → 証拠 → 典拠の読み順が 1 カラムで成立。横スクロールなし |
| manifesto-article-narrow.png | 480px | 同じ読み順が縦に伸びるだけで情報は欠落しない。横スクロールなし |
| manifesto-landing.png | 1440px | hero + 問いカード 2 列 + 典拠 strip が 1 画面の流れに収まる。横スクロールなし |
| manifesto-landing-narrow.png | 480px | カードが 1 列に落ち、CTA が折り返す。横スクロールなし |

比較の観測（評価ではなく記録）:

- **記事案**は各問いの証拠と未確認リストをその場に展開するため、読む人は「問い → 根拠 → 未決」を一続きに追える。代わりに 1 画面の主張が弱く、入口が分散する。
- **LP 案**は hero の 1 文と CTA 2 本で入口を 1 つに絞り、問いをカードに圧縮する。証拠の内訳（各証拠の文・未確認の中身）はこの画面には出ず、データには残るが表示は集約される。
- どちらが「制作哲学の容れ物」として適切かは owner の判断であり、本 preview は決めない（§7）。

## 5. 本文との一致（parity gate）

`docs/verification/vision/manifesto-preview.md`（本書）と preview データ `src/personal/manifesto/Manifesto.preview.ts` の一致は `scripts/check-manifesto-preview-parity.test.mjs` が検証する。

- 本書に、全 question の heading / question / miroAxis、全 source の path、全 material の label、全 link の URL、全 note が verbatim で存在すること。
- 全 `source.path` がリポジトリに実在すること（移動・削除された典拠を指すと fail）。
- 全 evidence / material の `sourceId` が宣言済み source に解決すること（根拠の無い引用を fail にする）。
- 2 つ以上の問いが**互いに異なる** `miroAxis` を持つこと（同一軸の引用は 1 つの問いであり、独立した問いの数に数えない）。

capture 側の検査は「preview データと**描画された DOM** の一致」を見る別系統であり、parity gate は「データと文書の一致」を見る。両方が通ることで「文書・データ・画面」の 3 面が同じものを指す。

## 6. 誤読・秘匿情報チェック

### 誤読チェック

- **Miro の原文を装わない**: 画面と本書が引用するのは Issue #512〜#516 が引用した見出し語だけである。Miro の付箋本文にはアクセスできず、年表・感情・数値・作品一覧は一切書いていない。
- **答えを断定しない**: 各問いの `open`（未確認）リストを画面に出し、「根本的にいいものの定義」「動機フィールドの形」は未決と明示する。標語・結論・自己評価スコアは置かない。
- **記録の範囲だけを主張する**: 証拠文は `src/portfolio/seed.ts` の `motivationMd`、`docs/adr/ADR-0017-*.md`、`docs/personal/*.md` の記述に限定し、記憶や推測で補っていない。parity test が典拠 path の実在を機械検査する。
- **「公開済み」と「掲載予定」を混同しない**: 本 preview は route 未接続の Storybook / harness 限定であり、公開ページであるかのような文言（「掲載中」「公開しました」等）はどこにも無い。`MANIFESTO_DOCUMENT.status` が `preview / 未公開` を明示する。
- **個人情報**: 実名・連絡先・所在地・家族構成・健康・思想信条の開示は含まない。登場するのは公開 repository と公開 portfolio が既に公表している作品名と判断記録だけである。

### 秘匿情報チェック

- preview データは公開済み記録の引用のみで構成し、private repo・非公開ドキュメント・`.tmp/`・環境変数・secret に由来する文字列を含まない。
- リンクは `MANIFESTO_LINKS` の 2 件（公開 repository・公開 portfolio index）に限定し、capture が未宣言 href を fail にする。認証付き URL・内部 URL・短縮 URL は無い。
- capture は loopback のみで動作し、deploy・remote binding・secret の読み出しを行わない（`capture-manifesto.mjs` の Safety 節どおり）。
- 本 preview は `src/personal/**`（obligation: personal → editorial のみ）に置かれ、route・binding・peer obligation を読まない。`scripts/check-architecture.mjs` の allowlist がこの境界を機械検証する。

## 7. 採用 / 保留・未確認

### 採用（本 Issue の成果物として）

- 同一データを記事案・LP 案の 2 容れ物で描く単独 preview（`src/personal/manifesto/`）。
- Miro の 2 価値を独立した問いとして保持するデータ構造と、その機械検査（parity test + capture の DOM 照合）。
- 実在する 2 つの記録（slug 判断・基盤再構築）を材料にした一画面提示と、狭幅・広幅の実画面 PNG 4 枚。
- 再現手順と誤読・秘匿情報チェック（本書 §2・§6）。

### 保留（owner 判断・別 Issue の領域）

- 制作哲学をサイトのどこに・どの容れ物で公開するか（記事 / LP / その他）は owner 決定。本 preview は比較材料であり、配置を決めない。
- 各問いの答え・定義文（「根本的にいいもの」の定義、動機フィールド）は Issue #512 / #514 が個別に扱う。本 preview は問いを残すだけで答えを書かない。
- 英語版・他 locale 版の要否（opt-in は必要な言語だけ、の原則どおり未作成）。
- copy editorial approval: `src/personal/**` は公開 copy surface（`quality/copy-editorial-surfaces.json`）の対象外であり、本 preview は route 未接続のため approval record は作成しない。公開面へ昇格する場合はその時点で owner の editorial 判断が要る。

### 未確認（owner 確認待ち）

- Miro の付箋本文（Issue 引用の見出し語以外）。
- 2 つの容れ物のどちらを（あるいは併用を）採用するか。
- 問いを公開面に出す場合の最終的な文面。

## 8. 再現手順

```sh
# 1. preview を Storybook で目視（任意）
pnpm run storybook   # → Preview / Manifesto → Article / Landing

# 2. 検証画像を再生成（4 枚とも）
node scripts/capture-manifesto.mjs

# 3. データと文書の一致を検査
node --test scripts/check-manifesto-preview-parity.test.mjs

# 4. capture script の契約テスト
node --test scripts/capture-manifesto.test.mjs
```

`--only=article-wide|article-narrow|landing-wide|landing-narrow` で 1 枚だけ再撮影できる。`--no-build` は既存 harness を再利用する（story を変えた場合は build し直すこと）。
