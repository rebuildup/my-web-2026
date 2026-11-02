# portfolio の語彙 — facet・種類・ラベル

`src/portfolio` が公開面に出す語を 1 箇所で決めるための決定記録。
対象は facet の表示語と、facet から導出した値に付けるラベルである。
Issue #813（2026-11-02）。

## 1. 決定

| 項目 | 決定 |
| --- | --- |
| facet の表示語 | `Develop` / `Video` / `Design` / `Other`（日本語は `開発` / `映像` / `デザイン` / `その他`） |
| 導出値のラベル | **`Kind`** |
| 導出値の語彙 | 仕事の**種類**を表す名詞（`Development` / `Video production` / `Design` / `Production`） |
| 語彙の所有者 | `src/portfolio/vocabulary.ts`（表示語とラベル）、`scripts/audit-legacy-portfolio.mjs#LEGACY_FACET_ROLES`（データ生成） |

## 2. ラベルが `Kind` である理由

`portfolio_project.role` に入る値は、旧サイト移行では facet から導出する。
facet は**プロジェクトの種類**を表す（`develop` は「開発の仕事である」）ので、
導出値も「どんな種類の仕事か」しか言っていない。

表示ラベルが `Role` だったとき、値は読者に対して**個人の役職**という、元の
データが主張していない意味を持った。「Role: Video production」は、その人が
映像制作の担当だったという主張に見える。facet はそれを言っていない。

読者はカードを見ても、どちらの意味で書かれたのか判別できない。判別できない
主張は、弱いほうの（そして真である）語に合わせる。`Kind` は、値が実際に
知っていることだけを名乗る。

## 3. 却下した選択肢

| 案 | 判定 | 理由 |
| --- | --- | --- |
| `Role`（現状） | 却下 | 個人の役職という、導出値が持たない主張になる |
| `Type` | 却下 | カードは同じ面で facet を「種類」の意味で既に表示しており、1 つの事実に 2 つのラベルが付く |
| `Discipline` / `Field` | 却下 | 値より狭い。`Production` や `Video production` を分野名として読ませるのは不正確 |
| `Position` | 却下 | `Role` と同じ過剰主張 |
| ラベルを付けず値だけ出す | 却下 | 何の値か分からない。`Period` と並ぶ定義リストの中で孤立する |

`Kind` は「役職ではない何か」を最短で言い、値の粒度と一致する。

## 4. データ側の語彙

`scripts/audit-legacy-portfolio.mjs` の `LEGACY_FACET_ROLES` が facet を
テキストにする唯一の場所である。値は仕事の種類を表す名詞で、人を指す
agent 名詞（`Developer`）にはしない。

owner が記録した値（`docs/migration/portfolio-2025-role-overrides.json`）は
facet 由来の値と区別できる形で台帳に残る（`role_source: "owner-recorded"`）。
公開面では両者は同じ `Kind` ラベルの下に出る。区別は台帳の監査用であり、
読者に説明する必要のある違いではない。

カードの定義リストは次の形になる。

```text
KIND      Development
PERIOD    2020 — 2021
```

## 5. 語彙が 1 箇所にあること

`src/portfolio/vocabulary.ts` が `FACET_LABEL` / `FACET_LABEL_JA` /
`KIND_LABEL` を持ち、`ProjectCard` / `PortfolioDetail` / `FacetFilter` が
そこから読む。同じ対応表が 3 つのコンポーネントに複製されていると、
1 つの事実が 1 つの面で 3 通りの名前を持つ（`Develop` と `Development` が
同じカードに並ぶ）状態を型でも lint でも止められない。

`about/` は自前の facet 語を持ち、`Role` ラベルも持つ
（`src/about/components/AboutPage.tsx` の identity 行）。これは**同じ語が別の
事実を指している**例である。`about` の `identity.role` は人物の立場
（学校・学年・職能）であり、`Role` はそこで正しい。`portfolio` の値は仕事の
種類なので `Kind` が正しい。同じラベルが 2 つの surface にあることは矛盾では
なく、**片方のラベルが、その owner が持っていない事実を名乗っていた**という
ことである。

`about` は `portfolio` の peer obligation であり、`about -> portfolio` の値
import は AGENTS.md §3 の依存表に無い（現在の edge は型のみ）。`about` は
facet 語も `Kind` も使わないため、語を揃えるための edge は要らない。

## 6. この決定が主張しないこと

- 誰がそのプロジェクトの担当だったか
- チーム規模（「1 人で作った」を含む）
- 専門性の程度や評価

値はプロジェクトの種類だけを述べる。表示ラベルはその範囲を出ない。

## 7. 公開コピーとしての扱い

`src/portfolio/**` は日本語公開コピーのレビュー対象（Issue #506,
`quality/copy-editorial-surfaces.json`）である。ラベルの変更はこの対象
ファイル内で行うが、差分に日本語テキストを含まないため
`pnpm run copy:approval:check` の判定は `not applicable` になる。ラベルを
日本語にする変更は、そのとき owner のレビュー記録を必要とする。

## 8. 未解決として残すもの

- **`portfolio_project.role` という列名**。保存名であって表示名ではないため
  表示の主張には影響しないが、`Role` という語がスキーマ・Notion プロパティ・
  移行スクリプトに残る。改名は D1 の migration・Notion の property・
  移行台帳を同時に動かす独立した変更であり、この Issue では行わない。
- **移行台帳の未決事項**。`scripts/audit-legacy-portfolio.mjs` の
  `OPEN_DECISIONS` にあった「表示ラベルは owner 判断」という項目は、この決定で
  解消した。台帳側の組み替え（`OPEN_DECISIONS` → `DECIDED`、`decided_by:
  'issue-813'`）は Issue #811 が行う。**この決定は owner 決定ではない**ので、
  台帳にもそのように記録される。
