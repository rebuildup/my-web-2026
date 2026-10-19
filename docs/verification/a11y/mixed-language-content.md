# 言語が混在する本文の部分 lang（WCAG 2.2 3.1.2）の検証 — 正常 / 空 / 失敗 / 縮小表示 (#409)

- 対象: `src/i18n/language-of-parts.ts`（契約 + fixture）と `src/editorial/language-of-parts.tsx`（出荷レンダリング）
- Issue: #409（`feat(a11y): 言語が混在する本文に部分lang属性を適用`）
- 成果物: `docs/verification/a11y/mixed-language-content.webp`
- 状態: **機械検査の半分は実装・検証済み**。実スクリーンリーダーでの読み上げは §6 に残る open decision

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/editorial/language-of-parts.stories.tsx` の `Gallery`（shipped story を harness が直接 import して描画） |
| capture 手段 | `pnpm run capture:a11y-language-of-parts`（`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → `sharp` で WebP 化） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの |
| viewport / DPR | 1440 x 900 / 1（`fullPage` 撮影） |
| 生成物サイズ | 1440 x 2996 px、**203 kB** WebP（quality 80、budget 300 kB） |
| 再現性 | **encode 段は決定的、ブラウザ撮影は byte 再現ではない**。再生成は視覚的に同一であることを目標とする |
| 本番非破壊 | 既定で外部通信なし。local harness build と loopback 配信のみ。deploy / remote binding / secret 値の読み出しは無い |

Issue は `docs/verification/a11y/mixed-language-content.png` を指定しているが、Playwright は WebP を書けず、検証 artefact のために tree に恒久的な大容量バイナリを置くのは妥当でないため（他 artefact と同じ方針）**`.webp`** を commit した。`scripts/capture-language-of-parts.mjs` は `.webp` 以外の出力先を拒否し、中間 PNG は削除する。

この画像は**実表示**の記録である。§4 の機械検査（属性・verdict・Chromium の accessibility snapshot）と §5 の人間の評価（実スクリーンリーダーでの読み上げ）は別のレイヤであり、どちらか片方だけで「満たしている」と主張してはいない。

## 2. 画面が示している状態（4 つ + 判定表）

| state | 表示しているもの | 根拠となる WCAG 2.2 |
| --- | --- | --- |
| 01 正常 | 日本語の本文に `architecture:check`（コード名）と `Dashboard`（英単語 1 語）を埋め込み、`lang="en"` の英文引用と `lang="ko"` の韓国語の文を 1 つずつ置く | 3.1.2 (A) |
| 02 空 | 日本語だけで書かれた本文。`lang` 属性が **0 個**であることが期待値 | 3.1.2 (A) / 機械付与の反例 |
| 03 失敗 | 拒否例 3 つ（`eng-US` / 文書言語と同じ tag / 本文が空）。いずれも `lang` を書かず、理由だけ `data-lang-verdict` に残す | 3.1.2 (A) |
| 04 縮小表示 | 01 と同じ本文を 320 px 列で再描画（reflow の目視用。適合の主張ではない） | 1.4.10 (AA) |
| 判定表 | `LANGUAGE_WCAG_MAPPING` をそのまま描画（machine 4 行 / human 2 行） | §6 |

## 3. 契約の中身（なぜ「機械で全部は付けない」のか）

SC 3.1.2 が求めるのは**文書言語と異なる passage** に `lang` を付けることだけで、全英単語への付与ではない。そのため policy は kind で権限を分ける:

| kind | 例 | verdict | 根拠 |
| --- | --- | --- | --- |
| `sentence` | 韓国語の 1 文 | `tagged` → `lang="ko"` | 音体系が文書言語と異なり、読み方が変わる |
| `phrase` | 英語の引用 | `tagged` → `lang="en"` | 文書言語と異なる言語の文脈が 2 語以上続く |
| `code` | `architecture:check` | `not-a-passage` | `<code>` が非テキスト表現である旨を示しており、発話対象ではない |
| `loanword` | `Dashboard` | `not-a-passage` | 日本語の規則で読まれる語。tag を付けると日本語の読み上げを壊す |

加えて 3 つの拒否がある: `tag-redundant`（tag が文書言語と同じ）、`malformed-tag`（canonical 化できない tag。`eng-US` のような ISO 639-2/3 の 3 文字コードを含む）、`empty-text`（本文が空）。**空の `lang=""` は書かない**（不正 HTML であり「未知の言語」として扱われる）。

判定順序は「構造的な objection を先に，问提着してから著者の意図を問う」という固定順で、同じ入力が 2 人の読者に違う結果を出さない。

## 4. 機械検査（人手レビューなしで再現する部分）

| 検査 | 場所 | 内容 |
| --- | --- | --- |
| tag 文法・verdict・guard | `src/i18n/language-of-parts.test.ts` | `inspectLanguageTag` の受理/拒否と理由、4 種の verdict、guard token の byte-exact、NFC |
| SSR markup | `src/editorial/language-of-parts.test.tsx` | `react-dom/server` の出力に `lang` が**意図した run だけ**に付き、拒否 run に付かないこと、heading id が一意であること |
| gate | `scripts/check-language-of-parts.mjs`（`validate:fast` 登録） | 10 rule: document-language-mismatch / dangling-part-reference / orphan-part / language-tag-required / language-tag-malformed / language-tag-redundant / language-tag-on-non-language / unobserved-verdict / guard-not-preserved / capture-drift |
| gate の単体 | `scripts/check-language-of-parts.test.mjs` | 各 rule が発火すること（負の fixture は Gate に投入していない） |
| capture harness | `scripts/capture-language-of-parts.test.mjs` | WebP 拒否・size budget・story を直接 import すること・静的配信の traversal 拒否・DOM 比較の 3 故障形 |
| capture 実測 | `scripts/capture-language-of-parts.mjs` | `document.documentElement.lang` と `[data-lang-part]` の実測値が policy の予測値と一致すること（不一致は exit 1） |

実 Chromium で採取した値（`article` の DOM 観測、`.tmp/a11y-mixed-language/report.json#capture.bodies` と同じ）:

```text
body article:false (normal)
  code-architecture-check  lang=null  verdict=not-a-passage
  loanword-dashboard       lang=null  verdict=not-a-passage
  quote-english            lang=en    verdict=tagged
  sentence-korean          lang=ko    verdict=tagged
body plain:false (empty)
  （part なし = lang 属性 0 個）
body refusals:false (failure)
  rejected-iso-639-3       lang=null  verdict=malformed-tag
  rejected-redundant       lang=null  verdict=tag-redundant
  rejected-empty           lang=null  verdict=empty-text
body article:true (compact)
  （article と同じ 4 part、同じ verdict）
document.documentElement.lang = "ja"
```

`article` パネルの accessibility snapshot（Chromium `ariaSnapshot`、`<code>` が code として出ている点に注目）:

```text
- region "混在本文（正常）":
  - text: "WCAG 2.2 3.1.2 (A) — document lang: ja"
  - heading "混在本文（正常）" [level=2]
  - paragraph: "日本語の本文に、コード名・英単語・英語の引用・韓国語の文が混在します。…"
  - paragraph:
    - text: 検証用の本文です。日本語の文に、
    - code: architecture:check
    - text: というコード名と、Dashboard という英単語 1 語を埋め込みました。…
```

- `lang` は role も内容も変えていない（`lang` を持つ要素は普通の `generic` text のまま）。これは 4.1.2 の主張の根拠。
- コード名は `code` として公開される。`lang` は付けていないので、「区別は `code` が担う」という設計が snapshot 上で確認できる。

## 5. 人間の評価が必要な部分（機械では判定できない）

| 論点 | 現状の判断 | 未実施 |
| --- | --- | --- |
| 実際に言語が切り替わるか | 属性は意図した 2 か所にしか付いていない（実測済み） | VoiceOver / NVDA / Orca での読み上げ確認。`lang="en"` / `lang="ko"` の run で声が切り替わり、tag の無い run は日本語のままであること |
| 引用・韓国語の文が文法として正しいか | 検証用 fixture であり、公開 copy ではない | 実際の記事 copy を使う場合の語順・文体。copy quality は編集者の仕事（`docs/domain/i18n.md` §5） |
| 縮小表示の実機挙動 | 320 px 列で同じ本文を描画 | 320 px / 200% ズームでの reflow の適合判断 |
| 支援技術ごとの `lang` 解釈差 | HTML 仕様通りの属性を書いている | 実機ごとの差（例: 一部の AT は tag 部分 lang を文章単位で再分割する） |

## 6. 未決事項 / 制約

1. **実スクリーンリーダーでの読み上げは未実施**。§5 のとおり、`LANGUAGE_WCAG_MAPPING` の `checked: 'human'` 行として open に記録しており、本 PR は 3.1.2 を満たしていると主張しない。
2. **実ページ（記事 Route）への適用は本 Issue の範囲外**。Issue が「未確定なページ配置には依存させない」と明記しているため、fixture と出荷 primitive のみを実装した。どの Route が混在本文を持つかは owner の決定事項として残る。
3. **`lint="off"` 相当の例外は作らない**。tag を機械付与する実装は `language-tag-on-non-language` / `language-tag-redundant` の 2 rule で gate が落とす。Unit test では、将来 classifier が機械付与へ変わった場合に備え、stub classifier で両 rule の発火を固定している。
4. **`lang` の canonical 化は「検証できるもの」だけ**。BCP-47 の private-use（`x-…`）と grandfathered tag は canonical 化できないため拒否する。必要になった時点で owner 判断として拡張する。
5. **Storybook 自体の static build は manager のみ**（Issue #501 と同一の制約）のため、capture は `.tmp/` の harness 経由。`build-storybook` 自体は `validate:integration` で走る。
6. **本文は fixture**。製品的事实・版の市区・ライセンス等を一切主張しない、表示検証専用の文である。

## 7. 再現手順

```sh
# 1. 機械 gate（validate:fast にも含まれる）
pnpm run a11y:language-of-parts:check

# 2. capture（harness を build して Chromium で実測し、WebP を書く）
pnpm run capture:a11y-language-of-parts
```

capture は `.tmp/a11y-mixed-language/report.json` に観測値・gate 予測値・WCAG mapping・viewport・encode 設定を書く。ハーネスは `.tmp/` に生成され、loopback の ephemeral port でだけ配信される。