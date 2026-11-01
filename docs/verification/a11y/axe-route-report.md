# 公開ルートの axe-core 実測と既知違反台帳（Issue #393）

> 検証対象: 公開ルート（`/` `/about` `/keyboard` `/contact` `/portfolio`
> `/portfolio/my-web-2026` `/projects/dotfiles` `/tools` `/design-system`
> `/admin/login`）の **描画済みの DOM**。
> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の **A / AA**。
> ゲート本体は `e2e/a11y/axe-public-routes.spec.ts`、
> 検査対象 manifest は `e2e/a11y/axe-manifest.ts`、
> 既知違反の台帳は `e2e/a11y/axe-baseline.json`。

## 何を追加したか

静的ゲート（#396 / #397 / #398 / #399）は **ソースの形** を検査する。
この Issue が追加したのは **描画された DOM** を機械に読ませる検査であり、
「機械が見えないものを適合と表示しない」ための装置である。

| 装置 | 役割 |
| --- | --- |
| `e2e/a11y/axe-manifest.ts` | 監査したルートの明示的な記録。-route / 期待する title / 期待する判定 / skip 理由を持つ。**nav roster から自動生成しない**（監査した範囲を自動生成すると、監査記録として反証できなくなるため） |
| `e2e/a11y/axe-public-routes.spec.ts` | manifest の各ルートを Chromium で開き、axe-core で WCAG 2.2 A/AA の違反を収集し、宣言・実測・台帳の 3 者を突き合わせる |
| `e2e/a11y/axe-baseline.json` | 既知の既存違反の台帳（1 違反 1 レコード）。**Issue #718 で記録されていた 10 レコードは実装側で直して削除した。現在 0 レコード** |
| `scripts/capture-a11y-axe-routes.mjs` | ゲート自身の実測結果から検証画像（WebP）を作る |

判定は 4 段構えで、**どれかが 1 つでも red なら spec が落ちる**。

| 状況 | 判定 |
| --- | --- |
| 観測した違反が台帳に無い | **fail**（新しい違反。release candidate を落とす。**manifest を読まない判定なので、宣言を書き換えても回避できない**） |
| 観測した違反がすべて台帳にある | **baseline**（記録済みの違反。**件数を必ず表示する**） |
| 違反が 1 件も無い | **pass** |
| 台帳のレコードに実測違反が対応しない | **fail**（台帳が陳腐化している） |
| 台帳のレコードに理由が無い | **fail**（許容の理由が無い記録は、決定ではなく脱落） |
| manifest の宣言と実測の判定が違う | **fail**（manifest が現実とずれている） |
| manifest が `fail` を宣言している | **fail**（宣言できない。宣言できる値は `pass` / `baseline` だけ） |
| manifest の監査 route と `quality/route-coverage.json` の a11y covered が食い違う | **fail**（route を manifest から外した改変も塞ぐ） |
| manifest に無いルートの台帳レコードがある | **fail**（孤立した台帳レコード） |
| skip した route に理由が無い | **fail**（理由の無い skip は許されない） |
| manifest の route が 404 / 200 以外を返す | **fail**（missing route を成功と偽らない） |
| baseURL が loopback ではない | **fail**（skip しない。「0 route を走査して exit 0」という silent green を作らない） |

台帳を空にして恒久 green にする回避は、4 段目（陳腐化検出）で塞いでいる。
1 件の違反を追加して baseline を 1 件減らした状態で **green には戻れない**。

### 「失敗が許される」のは台帳だけ

manifest の `expect` が宣言できるのは `pass` と `baseline` の 2 値だけで、
`fail` は **宣言できない**（型にも run time の検査にも無い）。
manifest の 1 語を書き換えて新規違反を隠す経路を作らないため。

- 違反が **恒久的に存在してよい** 場合は、**台帳**
  （`e2e/a11y/axe-baseline.json`）に 1 レコード追加し、`reason` に許容理由を書く。
  台帳は別ファイルなので、許容の判断は **差分として見える**。
- manifest の宣言は「違反が 1 件もない（`pass`）」か
  「違反がすべて台帳に載っている（`baseline`）」のどちらかでしかあり得ない。
  実測が `fail`（台帳に無い違反がある）なら、宣言の値に関係なく **必ず red**。

### 宣言を書き換えて隠せないことの確認（attack）

reviewer が報告した「manifest の `expect` を書き換えると新規違反が通る」経路は、
次の手順で自分の作業ツリーで再現・否定した（攻撃の入力は作業後にすべて戻した）。

| 攻撃 | 結果 |
| --- | --- |
| `/tools` に `alt` の無い `<img>` を 1 枚足して build する | **1 failed / 15 passed**（新規違反が red になる） |
| 同じ違反のまま `expect: 'pass'` を `expect: 'fail'` に書き換える（型も `fail` を含めるまで改変） | **2 failed / 14 passed**（route の判定と「manifest が `fail` を宣言していないか」の検査の両方が red） |
| 同じ違反のまま `/tools` を manifest から削除する | **1 failed / 14 passed**（coverage ledger との整合検査が red） |
| 攻撃をすべて戻す | **16 passed** |

## 適用対象

| 項目 | 値 |
| --- | --- |
| 対象ルート | `/` `/about` `/keyboard` `/contact` `/portfolio` `/portfolio/my-web-2026` `/projects/dotfiles` `/tools` `/design-system` `/admin/login`（10 件） |
| ページ状態 | 通常描画のみ（初期ロード、`networkidle` まで待機）。ログイン済み状態・検索語を入力した状態・ツールの iframe 内部は対象外 |
| viewport | 1280 × 720（Playwright `devices['Desktop Chrome']`、deviceScaleFactor 1） |
| ブラウザ | Chromium のみ（CI が Chromium しか入れていないため。2 引擎目は `cross_browser` family の課題） |
| 実行先 | **ローカルの preview サーバのみ**（`scripts/e2e-local-bootstrap.mjs` → `vite preview`、loopback）。本番 URL には呼びかない（baseURL が loopback でない場合は **skip ではなく fail**。skip すると「0 route を走査して exit 0」という silent green になる） |
| 収集する結果 | `axe.run` の `violations` のみ（`resultTypes: ['violations']`）。passes / inapplicable / incomplete は収集しない |
| 走査する rule タグ | `wcag2a` `wcag2aa` `wcag21a` `wcag21aa` `wcag22aa`（axe-core 4.14.0 がすべて受理する。存在しないタグを渡すと axe は例外を投げるため、**外したタグは無い**） |

`best-practice` タグは **含めない**。これらは WCAG の達成基準ではなく、
「house style の違反」を適合の欠陥として報告することになるため。

## 対象外（skip した route とその理由）

skip は **理由つきでだけ** 許される。理由の無い route は manifest に載せない。

| route | 理由 |
| --- | --- |
| `/tools/prototype` | `third-party-content` — Tool 本体は同一オリジンの iframe に載る第三者コードで、shell（`/tools`）は監査済み。バンドル自身は別のスコープ |
| `/admin` | `layout-route-without-a-surface` — 子ルートの Outlet だけを返す layout route で、文書面を持たない |
| `/admin/invitations` | `authentication-required` — Better Auth が保護し、`e2e/` に sign-in fixture が無い |
| `/admin/invitations/accept` | `not-reachable-without-a-fixture` — 招待とセッションを用意する fixture が無い |
| `/admin/keys` | `authentication-required` — 同上 |
| `/admin/images` | `authentication-required` — 同上 |
| `/admin/emoji-catalog` | `authentication-required` — 同上 |

`/admin/login` は sign-in が要らない公開文書なので **監査対象** に含めている
（台帳 0 件 = pass）。

## 基準（WCAG 2.2 の達成基準と axe の rule id の対応）

走査タグ `wcag2a` `wcag2aa` `wcag21a` `wcag21aa` `wcag22aa` は
axe-core 4.14.0 の **70 個の rule** を有効にする。rule id と達成基準の
対応は次のとおり（axe の `wcagNNN` タグがそのまま達成基準番号になる）。

| 達成基準 | レベル | rule id |
| --- | --- | --- |
| SC 1.1.1 Non-text Content | A | `aria-meter-name`, `aria-progressbar-name`, `image-alt`, `input-image-alt`, `object-alt`, `role-img-alt`, `svg-img-alt` |
| SC 1.2.1 Audio-only and Video-only (Prerecorded) | A | `audio-caption` |
| SC 1.2.2 Captions (Prerecorded) | A | `video-caption` |
| SC 1.3.1 Info and Relationships | A | `aria-hidden-body`, `aria-required-children`, `aria-required-parent`, `definition-list`, `dlitem`, `list`, `listitem`, `p-as-heading`, `table-fake-caption`, `td-has-header`, `td-headers-attr`, `th-has-data-cells` |
| SC 1.3.4 Orientation | AA | `css-orientation-lock` |
| SC 1.3.5 Identify Input Purpose | AA | `autocomplete-valid` |
| SC 1.4.1 Use of Color | A | `link-in-text-block` |
| SC 1.4.2 Audio Control | A | `no-autoplay-audio` |
| SC 1.4.3 Contrast (Minimum) | AA | `color-contrast` |
| SC 1.4.4 Resize Text | AA | `meta-viewport` |
| SC 1.4.12 Text Spacing | AA | `avoid-inline-spacing` |
| SC 2.1.1 Keyboard | A | `frame-focusable-content`, `scrollable-region-focusable`, `server-side-image-map` |
| SC 2.1.3 Keyboard (No Exception) | AAA | `scrollable-region-focusable` |
| SC 2.2.1 Timing Adjustable | A | `meta-refresh` |
| SC 2.2.2 Pause, Stop, Hide | A | `blink`, `marquee` |
| SC 2.4.1 Bypass Blocks | A | `bypass` |
| SC 2.4.2 Page Titled | A | `document-title` |
| SC 2.4.4 Link Purpose (In Context) | A | `area-alt`, `link-name` |
| SC 2.5.3 Label in Name | A | `label-content-name-mismatch` |
| SC 2.5.8 Target Size (Minimum) | AA | `target-size` |
| SC 3.1.1 Language of Page | A | `html-has-lang`, `html-lang-valid`, `html-xml-lang-mismatch` |
| SC 3.1.2 Language of Parts | AA | `valid-lang` |
| SC 3.3.2 Labels or Instructions | A | `form-field-multiple-labels` |
| SC 4.1.2 Name, Role, Value | A | `aria-allowed-attr`, `aria-braille-equivalent`, `aria-command-name`, `aria-conditional-attr`, `aria-deprecated-role`, `aria-hidden-focus`, `aria-input-field-name`, `aria-prohibited-attr`, `aria-required-attr`, `aria-roledescription`, `aria-roles`, `aria-tab-name`, `aria-toggle-field-name`, `aria-tooltip-name`, `aria-valid-attr`, `aria-valid-attr-value`, `button-name`, `duplicate-id-aria`, `frame-title`, `frame-title-unique`, `input-button-name`, `label`, `nested-interactive`, `select-name`, `summary-name` |

2026-10-23 の実測で観測された rule は `list` / `definition-list`（SC 1.3.1）と
`label-content-name-mismatch`（SC 2.5.3）の **3 種類**。`color-contrast`
（SC 1.4.3）は Issue #399（PR #681）の muted token 修正で **解消済み** で、
実測では 1 件も観測されない。

**2026-11-01（Issue #718）の実測では違反は 1 件も観測されない**（10 route すべて
`pass`）。上の 3 種類の rule は **実装側で直した**（内訳は §「今回の増減」、
詳細は [`axe-known-violations.md`](axe-known-violations.md)）。

## 機械検査と人間の評価の区別

### 機械が決めること

- その route が HTTP 200 で、manifest が宣言した title を返すか（404 を「監査できた」とは言わない）
- どの rule id が発火したか、その rule の WCAG タグは何か
- 違反した要素がどれか（axe の要素セレクタ）
- その違反が台帳に載っているか、載っていないか（＝新規違反か）
- 台帳のレコードが実測と対応しているか（＝台帳が陳腐化していないか）
- 台帳のレコードに理由があるか（＝許容の判断が書かれているか）
- manifest の宣言した判定と実測の判定が一致しているか
- manifest が `fail` を宣言していないか（＝宣言できる値か）
- manifest の監査 route と `quality/route-coverage.json` の a11y covered が一致しているか
- 走査の origin が loopback か（本番を測っていないか）

### 人が評価すること（このゲートは判定しない）

- 記録済みの違反を **設計判断として** 許容してよいか（前景色と背景色のコントラストの取りうる値など）
- 代替テキスト・`aria-label` の文言が読み手に伝わるか
- キーボード操作だけで主要フローが完了できるか（このゲートは測らない）
- スクリーンリーダー実機での読み上げ品質（このゲートは測らない）
- 200 % ズーム・狭幅・ダークモードでの見え方（このゲートは 1280 × 720 の 1 viewport だけ）
- 台帳に残すか消すかの最終判断（.owner の判断）

## baseline 台帳の扱い

`e2e/a11y/axe-baseline.json` は **既知の既存違反の台帳** である。
1 レコード = 1 route × 1 rule で、`nodes` に axe の要素セレクタ、
`reason` に「なぜ受け入れるか」、`recordedAt` に記録日を持つ。

- **レコードの削除は「違反を直した場合だけ」。** 残したまま実測から消えると台帳が陳腐化し、
  spec が red になる（陳腐化検出）。これは「台帳 emptied して恒久 green にする」、
  という回避を塞ぐための仕組み。
- **新しい違反は台帳に足さない。** 台帳に足すのは「直せない・受け入れる」と
  人が判断した記録だけ。足すときは `reason` に判断理由を書く。
- セレクタは React の `useId` が生成する id（`_R_…`）を `«id»` に正規化して
  比較する（リビルドで id が変わっても台帳が壊れないため）。

### 今回の増減（Issue #718 で更新）

| 項目 | 件数 |
| --- | --- |
| 今回記録した違反（route × rule） | **0** |
| 今回記録した違反（要素単位） | **0** |
| 今回直した違反 | **10**（要素数 14） |
| 今回削除した台帳レコード | **10** |

**Issue #718（2026-11-01）** が、2026-10-23 に記録していた 10 レコード
（要素数 14）を **実装側で直して削除した**。改正の詳細は
[`axe-known-violations.md`](axe-known-violations.md) に記録した。

内訳（route × rule・修正前）:

| route | rule | 要素数 | 理由 | 所有者 | 直し方 |
| --- | --- | --- | --- | --- | --- |
| `/` | `definition-list` | 1 | home の status リストが `<dl>` の group に badge 用の `<div>` を置いていた（SC 1.3.1 の content model 違反） | `home` | `src/home/status/tiles.tsx` — badge の wrapper を `<dd>` にした |
| `/` | `label-content-name-mismatch` | 2 | `aria-label` が可視テキストを含まない（SC 2.5.3） | `home` | `src/home/capabilities/grid.tsx` — `aria-label` に可視の EN ラベルを含めた |
| `/about` `/keyboard` `/contact` `/portfolio` `/portfolio/my-web-2026` `/projects/dotfiles` `/design-system` | `list` | 各 1 | デスクトップ nav が `<ul>` の直下に `<a>` を置いていた（SC 1.3.1） | `editorial` | `src/editorial/nav/PublicNav.tsx` — 各項目を `<li>` で包んだ |
| `/portfolio` | `label-content-name-mismatch` | 4 | facet フィルタボタンの `aria-label` が可視テキストを含まない（SC 2.5.3） | `portfolio` | `src/portfolio/components/FacetFilter.tsx` — `aria-label` に可視の JA ラベルを含めた |

修正後の実測（2026-11-01）: **10 route すべてで violation 0 件 / node 0 件**。
台帳は **0 レコード**、manifest の 10 route はすべて `pass`。

### 台帳の更新履歴

| 日付 | 変更 | 理由 |
| --- | --- | --- |
| 2026-10-23 | `axe-baseline.json` を version 1 → 2。`color-contrast` の 7 レコード（要素数 39）を削除 | Issue #399（PR #681）が muted 文字 token を `neutral.500`（`bg.subtle` 上で 4.34:1）から `neutral.600` へ変え、SC 1.4.3 の `color-contrast` 違反が **すべて解消** した。実測に対応しなくなったレコードを残すと、gate の陳腐化検出（「直った違反のレコードは削除せよ」）が赤くなる。これは **設計どおりの挙動** で、Issue #692 でレコードを削除して解消した |
| 2026-11-01 | `list` 7 件 / `definition-list` 1 件 / `label-content-name-mismatch` 6 件の計 **10 レコード（要素数 14）を削除**。manifest の 8 route の `expect` を `baseline` → `pass` に | Issue #718 が **実装側で違反を直した**（`editorial` の nav markup、`home` の status リストと capability link、`portfolio` の facet chip）。視覚は pixel 比較で不変であることを確認した（§「負の対照」と `axe-known-violations.md` §5）。**空の台帳が恒久 green にはなっていない**ことは、nav の markup を意図的に戻した再ビルドで gate が red になることを確認した |

2026-10-23 の 7 レコード削除も、2026-11-01 の 10 レコード削除も、どちらも
「違反を直した」ことによるもので、台帳を空にして恒久 green にする回避ではない。

**台帳が空になったのであって、ゲートが緩んだのではない。** 2026-11-01 の
実測では 10 route すべてで違反が観測されない（`pass`）。このゲートの目的は
「新しい違反が release candidate で fail すること」であり、Issue #718 は
記録されていた違反を実装側で直して、この目的を **台帳の穴で覆わない** ようにした。

## 誤検知・誤陰性を見つけたときの扱い

| 状況 | 対応 |
| --- | --- |
| axe が誤検知している（実際は適合） | 当該 rule の **コード側を直して** ゲートを再実行する。rule 全体を無効化する手段は本 Issue には無い（runOnly のタグ集合は manifest の `AXE_TAGS` にあるだけで、route 単位で除外する仕組みは持たない） |
| 機械では直せないが受け入れる（false positive を記録する） | 台帳に 1 レコード追加し、`reason` に「なぜこの環境では許されるか」を書く。**route 全体の除外はしない**（他の違反を見逃すため） |
| 誤陰性（axe が通す SHOULD / 推奨の違反） | このゲートは **A / AA だけ**を扱う。AA を超える基準（例: SC 2.5.5 Target Size (Enhanced)）は tag に入っていないので検出されない。検出機構を追加する場合は `AXE_TAGS` と本表を同時に更新する |
| 台帳のセレクタが実測と合わない | 要素の class や構造が変わった可能性が高い。**台帳を現状に合わせて書き換える**（ただし「直して消えた」場合だけレコード削除。構造変更だけならセレクタ更新） |
| manifest の宣言と実測が食い違う | 違反が **追加** されたか **直った**かのどちらか。直ったなら manifest の `expect` を `baseline` → `pass` に、台帳のレコードを削除する。追加されたなら直してから台帳を足す（新規違反を台帳で隠さない） |
| 「この route は恒久的に fail する」と宣言したい | manifest では宣言できない（宣言できる値は `pass` / `baseline` だけ）。**台帳**（`e2e/a11y/axe-baseline.json`）に route × rule のレコードと `reason` を足す。台帳に無い違反は新規の違反として必ず red になる |

## スクリーンショット

`docs/verification/a11y/axe-route-report.webp`（Issue #393 が指定する
`axe-route-report.png` の WebP 版。PNG はリポジトリに置いていない）。

- 生成: `pnpm run capture:a11y-axe-routes`
- 中身: **ゲート自身の JSON レポート**（`e2e/a11y/axe-public-routes.spec.ts` が
  添付する route ごとの実測 summary）から描いた監査表（route / 判定 /
  台帳の既知件数と新規件数 / rule id と WCAG タグ / 要素数）と、
  実際に違反した要素のスクリーンショットを並べてある
- **Issue #718 で違反が 0 件になったため、要素のスクリーンショットの図は
  含まれない**（生成スクリプトは「違反のある route が 1 つもない」場合は
  図を省き、監査表だけを描く。2026-11-01 再生成：10 route 実測 / 58 kB）
- 失敗条件: 出力パスが `.webp` でなければ拒否（PNG は書かない）。
  中間 PNG は `.tmp/` に作り、最後に削除する

## 検証コマンド

```bash
pnpm run a11y:axe:check          # ゲート本体（Playwright spec）
pnpm run capture:a11y-axe-routes # 検証画像（WebP）の生成
pnpm run routes:quality:check    # route × gate family の台帳との整合
pnpm run e2e                     # 既存スイートも含めて走る（CI の release step）
```

`pnpm run a11y:axe:check` は preview サーバを要求するが、
Playwright の `webServer`（`scripts/e2e-local-bootstrap.mjs`）が自動起動する。
`dist/` が要る場合は先に `pnpm run build`、ブラウザが無い場合は
`pnpm run e2e:install` を実行する。

## 既知の制約

- **Chromium 1 引擎・1280 × 720 の 1 viewport だけ。** ダークモード、
  狭幅、Firefox / WebKit はこのゲートの対象外（それぞれ `cross_browser` /
  `performance` family の課題）。
- **描画後の静的解析であり、支援技術の実挙動ではない。** 読み上げの順序や
  キーボード操作の完走は測っていない。
- **`/tools/prototype` の中身は測っていない。** 同一オリジンの iframe に載る
  第三者コードで、shell と bundle は別のスコープとして扱う。
- **台帳のセレクタは class 依存。** Panda の utility class 名が変わると
  台帳は陳腐化検出で red になる（意図通り。PR で台帳を合わせて更新する）。
- **`/admin/login` は Better Auth の secret が無い環境でも 200 を返す。**
  ローカル preview は secret 未設定で動くため、CI と同じ条件下で測定している。
