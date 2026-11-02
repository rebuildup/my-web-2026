# portfolio の語彙 — 担当値と仕事の種類

`src/portfolio` が公開面に出す `role` と facet の語を決める決定記録。
Issue #813（2026-11-02）。

**この文書は訂正版である。** 初版（PR #819、commit `6a1acb51`）は `Role`
ラベルを `Kind` に一律で置き換えたが、owner に差し戻された。§1 に却下理由、
§3 以降に訂正した設計を書く。**この決定は owner 決定ではない**（内容設計の
決定であり、owner が承認したのは「一律置換は不可」という差し戻しまでである）。

## 1. 却下された決定と、訂正の結論

初版は `role` 列の値をすべて「仕事の種類」とみなし、表示ラベルを `Kind` に
した。owner の指摘は、その前提そのものが誤りだというものだった。

| 値 | 初版の扱い | 実際の意味 |
| --- | --- | --- |
| `Tool developer` / `Plugin developer` | `Kind` | **人の役割**（その仕事で担った立場） |
| `Development` / `Video production` / `Design` | `Kind` | **仕事の種類**（facet の言い換え） |

一律置換は、人の担当に対しても「あなたは何の種類の仕事をした人か」と読ませる。
それは初版が避けようとした過剰主張を、向きを変えて作り直しただけだった。

訂正の結論は 3 つである。

1. **`Role` ラベルは残す。** 人の担当に対しては正しい
   （`Tool developer`、`Intern`、`Solo developer / distributor`）。
2. **仕事の種類は `role` 列に入れない。** facet の言い換えは `facets` が既に
   持っており、公開面も既に表示している（§5）。ラベルを付け替えて載せ続ける
   のではなく、**投影をやめる**。
3. **表示は「担当が記録されているときだけ `Role` 行を出す」に変わる。**
   種類は facet の表示が担う。

## 2. 実測（この判断の根拠）

判断の前に、実際に何件がどの状態にあるかを数えた。以下の数値はすべて
`docs/migration/portfolio-2025-inventory.json`、`src/portfolio/seed.ts`、
`migrations/0007_portfolio.sql` から読んだものである。

### 2.1 移行台帳 151 件

| `role_source` | 件数 | `role` の値 |
| --- | --- | --- |
| `facet-derived` | 64 | `Video production` 35 / `Development` 19 / `Design` 10 / `Production` 0 |
| `owner-recorded` | 4 | `Tool developer` 3 / `Plugin developer` 1 |
| （なし） | 83 | `null` |

`owner-recorded` の 4 件は `docs/migration/portfolio-2025-role-overrides.json`
の `role_overrides` である（`aulymo-v01` / `aulymo_v02` / `aulymo_v03` →
`Tool developer`、`MultiSlicer` → `Plugin developer`）。4 件とも `grounded: true`
で、`docs/personal/domain.md §8 'Tool / plugin development'` を出典に持つ。
同ファイルは「チーム規模は別の主張なので `Solo developer` に膨らませない」
ことと「対応表に無い行は `role` を NULL のままにする」ことを明記している。

`Production`（`other` facet の派生値）は **0 件**で、この分岐は一度も実行されて
いない。

### 2.2 公開 seed 6 件（`src/portfolio/seed.ts`）

6 件すべてが人の担当で、生成値も `null` も無い。

| slug | 行 | `role` | `facets` |
| --- | --- | --- | --- |
| `my-web-2026` | 83 | `Solo architect / developer` | `develop` |
| `aulymo` | 124 | `Solo developer / distributor` | `develop`, `design` |
| `multi-slicer` | 148 | `Solo developer` | `develop` |
| `tastile` | 167 | `Solo developer` | `develop` |
| `project-init` | 187 | `Author / maintainer` | `develop` |
| `sciencearts-optim-internship-2026` | 218 | `Intern` | `develop` |

これらは facet から復元できない情報を持つ（`Solo` / `distributor` / `Author` /
`Intern`）。**公開面に出ている `Role` 行は、いま全件が正しい。**

### 2.3 D1 の現状

`migrations/0007_portfolio.sql:59` は `role TEXT NOT NULL`。
`scripts/migrate-portfolio-from-2025.mjs:447-453` は、override の無い行に
`'(unverified — owner review required)'` という文を書き込む（`NOT NULL` を
満たすため）。同スクリプトは facet からの推測を明示的に拒否している。

移行 151 件はまだ D1 に存在しない（`publication: pending_owner` が 60 件、
残りは `null`）。したがって**現時点の公開面に生成値は 1 件も出ていない**。
この問題は、#811 の移行が着地したときに初めて表面化する。

### 2.4 生成値と facet 表示の一致

生成値 64 件のうち:

- **59 件**は `facets[0]` の言い換えである（`video` → `Video production`）。
- **5 件**は `facets[0]` と一致しない。

| id | `facets` | 生成値 | `facets[0]` の言い換え |
| --- | --- | --- | --- |
| `baramoji` | `design`, `develop` | `Development` | `Design` |
| `code-type` | `design`, `develop` | `Development` | `Design` |
| `FoldLayers` | `design`, `develop`, `video` | `Development` | `Design` |
| `kosen-fes-2025` | `design`, `develop` | `Development` | `Design` |
| `reel-2025` | `design`, `video` | `Video production` | `Design` |

原因は 2 つの順序の不一致である。生成側は
`LEGACY_FACET_ROLE_PRIORITY = ['develop', 'video', 'design', 'other']` で
1 つを選び（`scripts/audit-legacy-portfolio.mjs`）、表示側は `facets[0]` を
見出しに使う（`ProjectCard.tsx:93-94`、`PortfolioDetail.tsx:156-167`）。
派生値 64 件のうち 6 件は facet を 2 つ以上持つ。

つまり生成値を表示すると、59 件は同じ事実の二重表示になり、5 件は**同じ
カードの上で別の種類を名乗る**（見出しは `Design`、`Role` 行は
`Development`）。どちらも読者に新しい情報を与えない。

## 3. `role` 列が混ぜている 2 つの意味

| | 人の担当（person role） | 仕事の種類（kind of work） |
| --- | --- | --- |
| 例 | `Tool developer` / `Plugin developer` / `Intern` / `Solo developer / distributor` | `Development` / `Video production` / `Design` |
| 何を主張するか | その仕事でその人が担った立場 | その仕事がどの種類に属するか |
| どこから来るか | `role_overrides` の記録、または seed に書かれた値 | `LEGACY_FACET_ROLES` による機械変換 |
| 誰が決めるか | 記録した人（grounded な出典を持つ） | `facets` 列の値 |
| facet から復元できるか | **できない** | できる（59/64。5 件は優先順位の差で異なる） |
| 読者にとって新しい情報か | はい | いいえ（同じ面に facet が出ている） |
| この列に置くべきか | はい | **いいえ** |

初版は、この 2 つを 1 つのラベルで覆おうとした。覆えない。種類の側を
**値ごと外へ出す**のが正しい対処である。

## 4. データ契約（3 状態）

3 状態の区別は**移行台帳が持つ**。台帳は「その行をどう書き込むか」を決める
ための台帳であり、3 状態はそこで初めて意味を持つ。

| 状態 | 台帳の表現 | 公開列に書く値 | 表示ラベル |
| --- | --- | --- | --- |
| 実証された担当値 | `role_source: "owner-recorded"`（`role_overrides` に grounded な出典がある） | `role = <値>` | `Role` |
| 生成値 | `role_source: "facet-derived"` | **`role = NULL`** | なし |
| 値なし | `role_source` なし | `role = NULL` | なし |

規則:

- **R1 — 生成値は公開列に投影しない。** `Development` / `Video production` /
  `Design` は `facets` の言い換えであり、`role` に入れると同じ事実が 2 箇所に
  保存される。`facets` が変わっても `role` は古いまま残る。
- **R2 — 推測しない。** `facet-derived` を `owner-recorded` に昇格させない。
  旧サイトの記録から担当が分かるのは 4 件だけで、それは変わらない（§6）。
- **R3 — 検証待ちの文を値として保存しない。**
  `'(unverified — owner review required)'` は担当ではない。`role` が
  nullable になった後は NULL を書き、未検証である事実は台帳の
  `role_source` に残す。担当が未検証であることは、担当が無いことと同じ
  公開上の意味を持つ。
- **R4 — 公開契約は 2 状態（担当あり / なし）で足りる。** 生成値と値なしは
  どちらも「この仕事について記録された担当はない」を意味し、同じ描画になる。
  生成値の由来を公開面で見せるのは、仕事ではなく**こちらの移行手順**について
  の主張になるため、§10 の owner 判断待ちに置く。

`src/portfolio/schema.ts` の `PortfolioProject.role` / `PortfolioProjectRow.role`
は `string` から **`string | null`** に広げる。D1 の列を nullable にするのは
#811 の ingest と同じ変更で行う（§8）。それまでは型だけが状態を許し、実際に
`null` を返す経路は無い。

## 5. そもそも表示する必要があるか

条件 (2) への回答。**担当は表示する。種類は表示しない。**

### 担当（`owner-recorded` と seed）

必要である。facet から復元できない情報を持つ。

- `Solo developer / distributor` の `distributor` は facet に無い
- `Intern` は雇用上の立場で、`develop` では言えない
- `Author / maintainer`、`Tool developer`、`Plugin developer` は担当の名前
- `Solo` はチーム規模の主張であり、facet とは別の事実

### 種類（`facet-derived`）

不要である。理由は 3 つ。

1. **重複。** 59/64 は `facets[0]` の言い換えで、カードは既に facet 語を
   見出し（`ProjectCard.tsx:93-94`）と pill（`:254-258`）に出し、詳細は
   見出し（`PortfolioDetail.tsx:156-167`）と pill（`:246`）に出している。
2. **矛盾。** 5/64 は見出しと違う種類を名乗る（§2.4）。1 枚のカードに 2 つの
   種類が並び、どちらが `facets[0]` なのか読者には分からない。
3. **粒度の嘘。** `Design` という生成値は facet 名の名詞化であり、
   その仕事の内容を何も足していない。足していない値を独立した行に置くと、
   足しているように見える。

### 描画規則

| `role` | カード（`ProjectCard`） | 詳細（`PortfolioDetail`） |
| --- | --- | --- |
| 非 null | `<dt>Role</dt><dd>{role}</dd>` | 同じ |
| `null` | 行を出さない（`Period` 行だけが残る） | 行を出さない（`Period` 行だけが残る） |

facet の表示（見出し語・pill・フィルタ）は変更しない。仕事の種類はそこで
読む。

## 6. 推測して追加しない

条件 (3) への回答。旧サイトのデータから担当が分かるのは
`role_overrides` の **4 件だけ**である。この 4 件以外に担当を足さない。

- `facet-derived` の 64 件は担当ではない。台帳に残るが、公開列には入らない。
- `role` が `null` の 83 件に担当を推測で入れない。
- 語彙を増やさない。`LEGACY_FACET_ROLES` は台帳の記録として残すが、公開
  語彙ではない。`Production` が 0 件であることも「直さない」— 使われていない
  分岐を、使われているように見せない。
- `role_overrides` の 4 件を「1 人で作った」に膨らませない。チーム規模は
  別の主張であり、`Solo` は seed に書かれた 6 件だけが持つ。

## 7. テスト（条件 (4) の 3 ケース）

3 状態を、それぞれ**その状態が現れる層**で固定する。

| # | ケース | 入力 | 期待 |
| --- | --- | --- | --- |
| 1 | 実証された担当値 | `role: 'Tool developer'` | `<dt>Role</dt>` と値が出る。生成値の語（`Development`）は出ない |
| 2 | 生成値 | 台帳が `facet-derived` の行。公開列は `role: null` | `Role` 行が出ない。facet の見出し語と pill は出る。`Development` も `Kind` も出ない |
| 3 | 値なし | `role: null`、facet は任意 | `Role` 行が出ない。空の `<dd>` を残さない |

ケース 2 は 2 か所で固定する。

- **書き込み境界**（`scripts/migrate-portfolio-from-2025.mjs` の単体テスト）:
  `facet-derived` の行に `role = NULL` を書く。生成値の文字列も sentinel も
  書かない。`owner-recorded` の 4 件だけが値を書く。
- **表示**（`ProjectCard.test.tsx` / `PortfolioDetail.test.tsx`）:
  `role: null` で `Role` 行が出ず、facet の表示は残る。

追加で、公開面に `Kind` というラベルが存在しないことを固定する
（初版の一括置換が戻ってこないようにする）。

## 8. 変更内容

### 0.8.1 で入れるもの（この Issue）

- `src/portfolio/schema.ts` — `role: string` → `string | null`（`PortfolioProject`
  と `PortfolioProjectRow` の両方、および写像）
- `src/portfolio/components/ProjectCard.tsx` / `PortfolioDetail.tsx` —
  `role` が非 null のときだけ `Role` 行を出す。ラベルは `Role` のまま
- `src/portfolio/vocabulary.ts` — `FACET_LABEL` / `FACET_LABEL_JA` の集約は
  **残す**（3 コンポーネントに複製されていた対応表を 1 箇所にする変更で、
  ラベルの問題とは独立である）。`KIND_LABEL` は**削除**
- `docs/domain/portfolio-vocabulary.md` — この文書

### #811 の ingest で行うもの（この Issue ではやらない）

- `migrations/` — `portfolio_project.role` を nullable にする。SQLite は
  `ALTER TABLE` で `NOT NULL` を外せないため、テーブル再構築になる。
  行数が少ないうちに 1 回だけ行う
- `role_source` 列の追加と、台帳からの書き込み（R1–R3）
- 151 件の移行本体、sentinel の廃止

## 9. この決定が主張しないこと

- 誰がそのプロジェクトの担当だったか（記録が無ければ何も言わない）
- チーム規模
- 専門性の程度や評価
- 生成値を持つ 64 件に担当が無いこと（記録が無い、と言うだけである）

## 10. 未解決として残すもの

- **`portfolio_project.role` という列名。** 保存名であって表示名ではないが、
  `Role` という語がスキーマ・Notion プロパティ・移行スクリプトに残る。
  改名は D1 migration・Notion property・移行台帳を同時に動かす独立の変更。
- **生成値の由来を公開面に出すか。** §4 R4 のとおり、いまは出さない。
  出すとすれば「この担当は facet からの派生である」という、仕事ではなく
  移行手順についての主張になる。**owner 判断待ち。**
- **`about/` との関係。** `src/about/components/AboutPage.tsx:226` は
  `{ label: 'Role', value: identity.role }` を持ち、`identity.role` は
  人物の立場（学校・学年・職能）である。訂正後は、`about` も `portfolio` も
  `Role` を**人についての事実**に使う。同じラベルが同じ意味で使われる形に
  なり、語を揃えるための edge は要らない。
- **台帳の未決事項。** `scripts/audit-legacy-portfolio.mjs` の
  `OPEN_DECISIONS` にあった「表示ラベルは owner 判断」という項目は、この
  決定で解消する（ラベルは `Role` のまま、種類は表示しない）。台帳側の
  組み替えは Issue #811 が行うが、**#811 が記録した `Kind` の記述はこの
  訂正に合わせて直す必要がある**（`decided_by: 'issue-813'` の resolution）。
