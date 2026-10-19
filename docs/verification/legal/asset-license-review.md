# 資産の権利 / 出典 / ライセンス検証 — 検証レポート (#497)

- 対象: `src/legal/**`（公開する資産の権利レビュー契約 + 表示 component）と `quality/asset-license-inventory.json`（レビュー済み記録）
- Issue: #497（`legal(content): 作品・フォント・画像素材のライセンス検証`）
- 成果物: `docs/verification/legal/asset-license-review.webp`（検証画面）、`asset-license-review-report.md`（機械生成の実行記録）
- 状態: **契約・記録・gate・表示 component・検証画面まで実装済み**。`/share/procon2026/` の同梱資産 91 ファイルは保留判定のままで、公開の継続は §6 の owner 判断事項として未決

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/legal/AssetLicenseReview.stories.tsx` の `AssetLicenseReviewGallery`（shipped story module を harness が直接 import して描画） |
| データ | **commit 済みの記録** `quality/asset-license-inventory.json`（story が import）。手書きのサンプルではない — 誰も出荷しないライセンスを証拠として撮らないため |
| capture 手段 | `node scripts/capture-asset-license-review.mjs`（`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → `sharp` で WebP 化） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの（実際の `src/styles.css`） |
| viewport / DPR | 1440 x 900 / 1（`fullPage` 撮影） |
| 生成物サイズ | 1440 x 3192 px、**188 kB** WebP（quality 80、budget 300 kB） |
| 撮影時の review card 数 | 2（script が `cardsRendered !== 2` で失敗する。空ページ撮影の黙認をしない） |
| 撮影時の判定 | `[publishable, hold]`（DOM の `data-decision` を実測） |
| 外部通信 | **0 件（実測）**。gallery は記録の描画のみで、どこにも要求しない。capture script が Playwright の request イベントを数え、loopback 以外が 1 件でもあれば artefact を書かずに失敗する |
| 成果物の書き込み | **検証通過後にだけ** 確定置き換わる。候補は `.tmp/asset-license-review/staging/` に encode され、budget / card 数 / 外部通信の検証を全部通ってから committed 経路へ move する |
| 再現性 | **encode 段は決定的、ブラウザ撮影は byte 再現ではない**（プロセス間でも差が出る）。再生成は視覚的に同一であることを目標とする |
| 時刻依存 | なし。`checkedOn` は記録が持つ日付で、`Date.now()` を使わない（Issue #499 の gallery と同じ方針） |

Issue は `.png` 経路を指定しているが、**同名の圧縮 WebP**（幅 1440、quality 80）で commit した。`scripts/capture-asset-license-review.mjs` は `.webp` 以外の出力先を拒否し、PNG はメモリ上の buffer のみでファイルを書かない。これは `release-0-6-3` 以降の `docs/verification/**` 規約（`docs/verification/security/README.md`）に従ったもので、Issue の置き換えは未決の owner 判断ではない。

## 2. 画面が示している条件

### 2.1 コンテンツ 1 件の権利 / 出典 / ライセンス

画面上段のカードは **既に公開されている静的ページ `/share/procon2026/`** 1 件を、権利・出典・ライセンス・再配布条件・根拠・公開パス・外部ホストまで表示する。`docs/verification/content/publication-surface.md` §3.2 が同 URL を「sitemap に入れないが公開到達可能」な公開面として記録しているので、この 1 件は匿名でも検証できる実在の資産である。

**badge が嘘をつかない理由**: badge は `record.publication`（「公開中である」という**宣言**）ではなく `review.decision`（証拠から**導出**した判定）を表示する。記録は「公開中である」とは書けるが「レビュー済みである」とは書けず、画面も導出した値しか出さない。

### 2.2 判断の分かれ目 — 同梱されているが由来未記録の資産

2 枚目は同じ component が `share-procon2026-fonts`（`public/share/procon2026/assets/fonts/**` の woff2 50 個）を描画する。判定は `hold` で、画面は 3 つの指摘を理由付きで出す。

| code | severity | 画面の条件 |
| --- | --- | --- |
| `L017` | info | 検証方法が「未検証」。権利・出典・ライセンスの証拠はこのリポジトリにない |
| `L018` | info | 第三者を同梱しているのにライセンスが記録されていない（`NOASSERTION`） |
| `L010` | warn | 証拠が不足している（保留）にもかかわらず、このリポジトリでは「公開中」と宣言されている |

**この 1 枚が本 Issue の発見そのもの**である。`@font-face` が `Material Symbols Rounded` と `Noto Sans JP` の family 名を宣言していることはリポジトリ内で確認できるが、**ライセンス本文・NOTICE・取得元はどこにもない**。family 名からライセンスは確定できないので、記録は `NOASSERTION`（= 条件を記録していない）であり `publishable` ではない。

### 2.3 記録一覧と監査範囲

画面下段は記録 12 件の判定一覧（判定 / id / 種別 / ライセンス / 対象 / 名称）と、§3 の監査範囲 3 項目（監査対象・公開する情報・外部通信）を並べる。

### 2.4 根拠行が「未確認」と書かれる理由

ブラウザはリポジトリのファイルを `stat` できない。だから各根拠行は既定で **「この画面では未確認」** と表示し、観測できた場合だけ `確認済み` / `見つからない` を出す。根拠の存在と sha256 の一致を**実際に**確かめるのは `pnpm run assets:license:check`（CI の `validate` ジョブで毎回走る）であり、その実行記録が `asset-license-review-report.md` である。提供側の URL は**ホスト名だけ**を表示し、パスや資格情報は表示しない（gate の status-only 契約と同じ規則）。

## 3. 公開情報 / 外部通信 / 監査対象と依存

### 3.1 監査対象（in scope）

| 対象 | 取得元 | 扱い |
| --- | --- | --- |
| Static Assets が verbatim で配信する全ファイル | `public/**`（現在 107 ファイル） | gate が列挙し、**1 ファイルにつきちょうど 1 件の記録**に主張されていなければ `L001` / `L002`（error） |
| 実行時に取得される参照資産（フォント） | `src/routes/__root.tsx`、`external/*/index.html` の `use.typekit.net` 参照 | 記録に「コピーを配布しない」ことを宣言させる。判定は `provider-terms` |
| ライセンス証拠のバイト | `LICENSE` ほか | sha256 を記録し、レビュー後に変われば `L005`（error）で再レビューを強制する |

### 3.2 監査対象外（out of scope）とその理由

- **`external/**`（Tool のソースと build 成果物）** — 同じバイトに 2 つの所有者が居ると記録の意味が失われる。Tool のライセンスファイル・lockfile・outbound host は Issue #466 の `quality/tool-artifact-inventory.json` と `pnpm run tools:artifact:check` が所有する。本 gate は audit に `public/**` だけを宣言している（`AUDITED_ROOTS`）。
- **`docs/**` / `e2e/**` / `migrations/**` / `scripts/**`** — 訪問者に配信されない。
- **`dist/client/**` の Tool 成果物** — build 後にしか存在しない。`publication:check` / `tools:artifact:check` の領域。
- **R2 の `MEDIA` オブジェクト** — 実行時に書き込まれるため commit 済みの記録では列挙できない。key の公開範囲は Issue #577 の `r2:media:audit` が所有する。
- **LICENSE の条文解釈** — 本 gate は条文の当否を判定しない。識別子がこのリポジトリが意味しうる値であること、根拠ファイルが存在して変わっていないことだけを検査する。

### 3.3 公開する情報（記録が持つもの）

`quality/asset-license-inventory.json` が持つのは **資産の権利属性だけ**である: id / 種別 / 名称 / 要約 / `covers`（リポジトリ相対 glob）/ `publicPaths` / 由来 / 権利者 / SPDX 識別子 / 再配布モード / attribution 要否・文言・表示先 / 再配布条件 / 検証方法 / 確認日 / 検証メモ / 根拠 / 公開状態 / 外部ホスト。

**持たないもの**: 氏名・連絡先・位置情報・利用実態・契約番号など個人データ。`rightsHolder` は文字列であり、本 Issue の記録は `rebuildup`（LICENSE の著作権者表記）と `null`（未記録）しか使わない。

### 3.4 外部通信

- **gate**: ネットワークを一切使わない。URL は `new URL(...).hostname` 相当の**ホスト名だけ**を出力し、パス・ポート・資格情報は出力しない。
- **検証画面**: 0 件（実測。§1）。参照資産のホスト名は記録から読むだけで取得しない。
- **网站側の外部通信**（本 gate の対象外だが記録が宣言しているもの）: `fonts.googleapis.com` / `fonts.gstatic.com`（本文フォント）、`use.typekit.net`（`/tools/prototype` が参照する Typekit フォント）。いずれも**コピーを配布していない**ため判定は `provider-terms`。

## 4. 判定コード

### 4.1 契約ルール（`src/legal/contract.ts`）

| code | severity | 条件 |
| --- | --- | --- |
| `L001` | error | 監査対象のファイルに資産記録がない |
| `L002` | error | 1 つのファイルを複数記録が主張している |
| `L003` | error | SPDX 識別子がこのリポジトリが意味しうる一覧にない |
| `L004` | error | 根拠として宣言したファイルが存在しない |
| `L005` | error | 根拠ファイルの sha256 が記録と一致しない（レビュー後に変更された） |
| `L006` | error | 管理対象外の資産に根拠が 1 件も宣言されていない |
| `L007` | error | 表示義務があるのに表示文言が記録されていない |
| `L008` | warn | 表示義務があるが表示先が記録されていない |
| `L009` | warn | `covers` が宣言しているパターンに一致するファイルがない |
| `L010` | warn | 保留なのに「公開中」と宣言されている |
| `L011` | info | 参照資産（コピーを配布しない）についての注記 |
| `L012` | warn | 参照資産なのに取得ホストが記録されていない |
| `L013` | warn | 検証方法が記録されているのに確認日がない |
| `L014` | error | 資産記録の id が重複している |
| `L016` | error | 提供者側の根拠 URL が https でない、または資格情報・パス・ポートを含む |
| `L017` | info | 検証方法が未検証（= 保留の理由） |
| `L018` | info | 第三者を同梱しているのにライセンスが記録されていない（= 保留の理由） |

### 4.2 記録の shape（`src/legal/inventory.ts`）

`J001`〜`J005` は記録ファイルが読めない場合の error で、**部分的に読めた記録をレビューしない**（fail-closed）。未知キーは拒否するため、`attributionDeliverdAt` のようなタイプミスが「表示义务なし」に化けることはない。

## 5. 実行方法

```bash
pnpm run assets:license:check   # CI が走る判定（WARN でも exit 0、error が出たら exit 1）
pnpm run assets:license:report  # .tmp/ の HTML レポート
pnpm run assets:license:doc     # docs/verification/legal/asset-license-review-report.md を再生成
pnpm run capture:asset-license-review  # 検証画面（WebP）を再撮影

# テスト（cheap）
node --test scripts/check-asset-licenses.test.mjs scripts/capture-asset-license-review.test.mjs
pnpm exec vitest run src/legal
```

## 6. 既知の制約（残るリスク）

1. **`/share/procon2026/assets/**` の 91 ファイルが保留のまま公開されている**（`L010` × 3）。本 gate が意図的に **warn** にしているのは、公開の継続／取り下げが **owner の公開判断**であり、gate が公開面そのものを変える権限を持たないためである。gate の責務は「保留なのに公開中」という矛盾を毎回可視化することまで。owner が次のどちらかを決めるまで `L010` は残る。
   - (a) 各フォントのライセンス表記・取得元を同梱し、PDF／画像の転載条件を `quality/asset-license-inventory.json` に記録する（`hold` → `publishable` になり `L010` は消える）。
   - (b) `/share/procon2026/` を取り下げる（`publication-surface` の snapshot 更新を伴う別 PR）。
2. **検証画面は根拠ファイルを確認できない**（§2.4）。画面は導出値と「未確認」を表示し、file に対する権限は gate だけが持つ。両者の判定が食い違う場合は gate の記録が正である。
3. **確認日は「存在する」ことしか検査しない**（`L013` は null のみ）。記録が古くなっても日数は数えない。鮮度を測る規則を追加することは owner 決定。
4. **Tool の同梱資産は本 gate の対象外**（§3.2）。`/tools/<slug>/app/**` のライセンス証拠は Issue #466 が所有しており、本記録は `delegatedTo` で参照だけ行う。
5. **`NOASSERTION` の判定そのものは法的な評価ではない**。この gate が問うのは「記録に証拠があるか」だけであり、条文の解釈や利用可否の判断は行わない。