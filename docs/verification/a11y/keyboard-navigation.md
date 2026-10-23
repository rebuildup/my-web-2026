# キーボードのみのナビゲーションを検証する（Issue #394）

> 検証対象: 既存の公開 route（`/` / `/about` / `/tools` / `/contact`）に
> shipping されているヘッダー nav、mobile menu、skip link、リアクション
> picker の `<dialog>`。
> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の
> **SC 2.1.1 / SC 2.1.2 / SC 2.4.1 / SC 2.4.3 / SC 2.4.7**。

本 Issue は **既存の route に対するキーボード回帰検査（Playwright spec）を
追加する** もので、新しい画面は作らない。検査の入口は
`pnpm run a11y:keyboard-nav:check`
（= `playwright test e2e/a11y/keyboard-navigation.spec.ts`）。spec は
`playwright.config.ts` の `testDir: './e2e'` に置き、したがって既存の
`pnpm run e2e`（CI の release gate）にも乗る。CI workflow YAML は変更して
いない。

## 何を直したか

回帰検査を 1 本書くという作業の結果、機械で決まる契約が 2 つ壊れている
ことにすぐ気づいた。**検査だけを追加して赤にする**のではなく、
契約側を直してから緑にした（緑 = 契約が満たされている状態）。

| 観点 | 修正前 | 修正後 |
| --- | --- | --- |
| mobile menu の Escape（`src/editorial/nav/PublicNav.tsx`） | Escape で panel は閉じるが、focus を持っていた要素が `hidden` になって**focus が body へ落ちた**。trigger へ戻らないので、キーボード利用者は次の操作の起点を失う | Escape で閉じたとき、DOM 更新（panel の `hidden`）の**後**に trigger へ focus を戻す。panel を隠す処理が focus を body へ落とす順序を避けて、復元は effect で行う |
| リアクション picker の Escape（`src/home/reactions/widget.tsx`） | native `<dialog>` は既定で Escape を `cancel` イベントに変える、とコメントは書いていたが、picker の検索 `<input>` が Escape を `preventDefault()` するため **close request が起きず、dialog が closable になかった**。唯一の解除手段は backdrop click（マウス）だった | `<dialog>` 自身に Escape の handler を置き、picker が key を消費したあとでも確実に閉じるようにする |

いずれも「見た目を整える」修正ではなく、**キーボードだけで到達・離脱
できる**という契約の修正である。

## dialog の focus 契約は key 不要の fixture で実効化する

cold review の指摘（F3）: リアクション picker の `<dialog>` は home
consumer API key（`MY_WEB_2026_CONSUMER_API_KEY`）が設定された
deployment でのみ描画されるため、**CI（key なし）では dialog の focus
契約が一度も走らない**。「未検証である」と記録するだけでも構わないが、
記録に残すなら spec と矛盾しない形にしなければならない。

そこで **選択肢 (a) を採用**した: `src/routes/design-system/` に
**出荷している `PickerModal` をそのまま描画する fixture**
（`/design-system` の「05 — Interactive」セクション内の fixture）を
置き、`e2e/a11y/keyboard-navigation.spec.ts` から駆動する。

- 検査対象は**本物**である。fixture が使うのは
  `src/home/reactions/widget.tsx` の `PickerModal` と同じ要素であり、
  コピーではない（Issue #486 の CLS fixture と同じ考え方: 検査対象は
  出荷要素、データだけを固定する）。
- 採る route: `/design-system` は key を要求しないため、**どの
  deployment でも**同じ契約が走る。key が必要なら「dialog の contract は
  環境依存」という記録だけが残り、CI は何も検査しないまま終わる。
- `PickerModal` を `export` する変更は 1 行と、その docstring だけ。
  fixture は `routes -> home`（登録済みの依存方向、AGENTS.md §3）の
  範囲内であり、新しい obligation を作らない。
- **bundle / 予算**: fixture は `/design-system` のルート chunk に
  含まれる。`pnpm run bundle:budget:check` の実測は
  `/design-system` の route-added JS **49.6 KiB**（エントリシェルに
  加えてこの route が持ち込む JS。gate の出力の 3 列目）で、budget は
  PASS した。ここで **余裕（headroom）** とは「上限 − 実測サイズ」で、
  上限を持つのは 2 指標だけである: initial JS は
  実測 1,731,135 B / 上限 1,740,000 B で余裕 8,865 B、
  initial CSS は実測 47,041 B / 上限 50,000 B で余裕 2,959 B。
  （route-added JS 自体には上限がないため「余裕」は定義されない。）
- **copy approval gate の対象外**: `quality/copy-editorial-surfaces.json`
  の `excludeGlobs` に `src/routes/design-system/**` があるため、この
  fixture の日本語 copy は owner の編集承認を要求しない。既存の
  `src/routes/design-system/sections/**` と同じ扱いで、**新しい公開
  copy 面を作らない**。とはいえ **新しい日本語 copy は追加していない**
  （fixture のデモラベルは、同セクションの `Primary CTA` / `Secondary`
  と同じ英語。picker 自体の検索プレースホルダーは
  `src/home/reactions/widget.tsx` の担当のまま、fixture は再宣言
  しない）。`node scripts/check-copy-editorial-approval.mjs
  --base=release-0-8-0` の verdict は **not applicable**（changed public
  segments: 0）。

これで dialog の focus 契約（focus 拘束・Escape 解除・focus 復帰）は
**key の有無にかかわらず** CI で緑になる。ホームの picker がある
deployment では、同じ契約が home 側でもそのまま走る（spec は 2 つの
状態を明示的に assert する: skip はしない）。

## cold review 指摘への対応

| 指摘 | 内容 | 対応 |
| --- | --- | --- |
| F1 | `src/editorial/nav/PublicNav.tsx` のコメント 6 行が日本語で、AGENTS.md §1「ソースコード、コミットメッセージは英語」に反していた | コメントを英語へ書き直した（**コードの意味は変えない**）。同ファイル内の既存の英語コメントと同じ書き方に揃えた |
| F2 | `e2e/a11y/keyboard-navigation.spec.ts` の `for (const stop of stops) expect(isSupportingElement(stop)).toBe(false)` は、walk が supporting element で終端するため **構造的に常に真**（守るものがなかった） | walk が **終端した情報**（`end`: どの supportive element に落ちたか）と **focus が前に戻らなかったか**（`forward`: 文書内並び位置が単調増加か）を観測する形に変更し、その 2 つを assert した。実効的な assertion は減らしていない（`end` が存在すること・`BODY` であること・per-stop の tag と識別子・`forward`・`wrapped`）。壊し方（focus を途中で失う）を入れた negative control と、出荷コードを実際に壊す attack の両方で赤くなることを確認した |
| F3 | dialog の focus 契約が、CI に consumer API key が無いため実質未検証だった | **選択肢 (a)** を採用: 出荷している `PickerModal` を `/design-system` の fixture として描画し、どの deployment でも同じ契約が走る。採用理由と、採らない (b) / (c) の理由は上の節に書いた |

### 2 巡目（d430f96a への cold review）の対応

| 指摘 | 内容 | 対応 |
| --- | --- | --- |
| R8 (major) | Issue の受け入れ条件 5 の「誤検知時の対応を記録」が成果物のどこにも無かった | 本 doc に「## 誤検知が起きたときの対応」節を追加した（どの assertion がどの route で誤検知しうるか / 解除手順 / 「閾値を緩めて緑にする手順は禁止」で、対象の拡大縮小は doc に宣言する） |
| R7 (minor) | doc が Issue の実名 `keyboard-focus-sequence.png` を引用せず、ファイル名が乖離した理由も書かれていなかった | 「## スクリーンショット」節を直し、Issue の実名と成果物の乖離を **ファイル名と拡張子の 2 点に分けて** 理由付きで書いた |
| R3 (minor) | `dialog-traps-focus` は dialog の modality を失っても緑のままだった（`showModal()` → `show()` で 13/13 緑） | spec を 2 段の assertion にした: 1) `dialog.matches(':modal')` が真であること、2) Tab の行き先が dialog 内の focus 可能要素の集合に収まること。既存「dialog 内に留まる」assertion は強化として残した。`show()` に置き換えた attack で**新しい test が赤くなる**ことを確認済み |
| R5 (minor) | 新規 spec のコメントが日本語 120 行（既存 e2e 15 本は 0 行。AGENTS.md §1「ソースコードは英語」） | spec のコメントをすべて英語へ書き直した（識別子・文言・assertion の意味は不変）。機械確認で日本語行数 **0** |
| R8 / R1 (minor) | PR 本文に「対象」節が無かった / doc の bundle 予算の数値（50.0 KiB）が実測（49.6 KiB）と食い違っていた | PR 本文に「## 対象」節を追加。doc の予算の記述を実測値へ直し、「余裕 = 上限 − 実測サイズ」の定義と、上限を持つ指標（initial JS / initial CSS）の実測値と上限を明記した |


## 適用対象

| route | URL | viewport | ブラウザ | 観測するもの |
| --- | --- | --- | --- | --- |
| Home | `/` | 1280 × 720（Playwright の Desktop Chrome 既定） | Chromium | skip link が最初の Tab stop / Enter で main へ / Tab walk 全体で focus を見失わない / Shift+Tab が逆順 / 唯一の `<dialog>` |
| About（nav opt-in page） | `/about` | 1280 × 720 | Chromium | ヘッダー nav の link に Tab で到達でき、Enter で遷移する |
| About（mobile menu） | `/about` | 600 × 800 | Chromium | menu が Enter で開き、Escape で閉じて **focus が trigger に戻る** |
| Tools | `/tools` | 1280 × 720 | Chromium | Tools 入口の link に Tab で到達でき、Enter でその Tool の画面へ遷移する |
| Contact | `/contact` | 1280 × 720 | Chromium | skip link に Tab で到達できる（channel 一覧は日次で変わるため件数や順序は固定しない） |
| Design system（dialog の fixture） | `/design-system` | 1280 × 720 | Chromium | 出荷している picker の `<dialog>` が focus を拘束し、Escape で閉じて、trigger へ focus を戻す |

- 実行コマンド: `pnpm run a11y:keyboard-nav:check`
- ブラウザ: Chromium のみ（`playwright.config.ts` の `projects` は chromium 1 つ。
  Firefox / WebKit は Issue #415 で別の config にある）
- 待ち合わせ: `networkidle` も sleep も使わない。待つのは
  `expect(locator).toBeVisible()` / `waitFor({ state: 'attached' })` だけ
- 乱数・時刻に依存しない。`/contact` の channel は 30 日の鮮度窓で
  入れ替わるため、**件数・順序を assert しない**（skip link への到達だけを
  見る）

## 対象外（理由つき）

| 対象 | 理由 |
| --- | --- |
| `/admin/*` | admin は自前の chrome を持つ別の obligation。公開導線のキーボード契約ではなく、管理者のセッション内操作の契約である |
| `/tools/<slug>` の Tool 本体 | Tool の iframe は**別 origin**（同一 document ではない）で、Tool 自身の bundle の所有物。ホスト側のキーボード契約ではない |
| `/portfolio` / `/portfolio/[slug]` | 公開行が D1 に存在する与否で Tab 順が変わるため、**順序を固定できない**。skip link は `#portfolio-detail` を持つが、判定が日次データに左右される（本 Issue は安定する route を選ぶ） |
| `/design-system` の**見本自体** | デザインシステムの見本画面は利用者の主要導線ではない。ただし Issue #394 の **dialog focus 契約の fixture** としてだけ使う（下記「dialog の focus 契約は key 不要の fixture で実効化する」）。TAB 順や copy の検査対象にはしない |
| `/keyboard` / `/projects/dotfiles` | 本 Issue の対象外として名指しされていない route。別の Issue の検査対象 |
| focus ring の見た目（コントラスト・視認性） | 機械では判定しない領域。#399 の gate と人が評価する（下記） |
| スクリーンリーダーの読み上げ・MCA 順序 | 機械では判定しない領域。人が評価する（下記） |
| `/contact` の「フォーム要素に focus が届くか」 | **`/contact` にはフォームが存在しない**（Issue #103: 検証済みの channel を列挙する静的画面）。入力要素は 0 個なので、対象が無いため check できない。spec は「`/contact` にフォームが増えたら赤くなる」形でこの事実を固定し、フォームが追加された時点で初めて focus 契約が要ることを示す |

## 該当する WCAG 2.2 の項目

| 基準 | レベル | 該当箇所 | 判定方法 |
| --- | --- | --- | --- |
| SC 2.1.1 Keyboard | A | 全 route の Tab 到達可能性、dialog の Escape での解除 | Chromium 実測（`toBeFocused()`） |
| SC 2.1.2 No Keyboard Trap | A | `<dialog>` を開いている間の focus 拘束、menu 閉鎖時の focus 復帰 | Chromium 実測（Tab 12 回の間、focus が dialog の外へ出ないこと） |
| SC 2.4.1 Bypass Blocks | A | skip link（`/` / `/contact`） | 最初の Tab stop が skip link で、Enter 後の次の Tab が `<main>` 内から始まること |
| SC 2.4.3 Focus Order | A | Tab 順序、Shift+Tab の逆走、menu 閉鎖時の focus 復帰 | Chromium 実測（`document.activeElement` の走査） |
| SC 2.4.7 Focus Visible | AA | focus ring の**見た目** | 機械では判定しない（#399 / 人が評価）。機械が確かめるのは「focus が可视状态下にある（focused な要素が画面内にある）」ことだけ |

## 機械検査と人間の評価の区別

### 機械で決まること（`pnpm run a11y:keyboard-nav:check`）

| 検査 | 内容 | 判定方法 |
| --- | --- | --- |
| `skip-link-first` | `/` の最初の Tab stop が skip link（`a[href="#main"]`）である | Chromium: 1 回目の Tab 後の `document.activeElement` |
| `skip-link-bypass` | Enter 後の次の Tab が `<main>` 内から始まる（sequential focus navigation starting point） | Chromium: `activeElement.closest('main') !== null` |
| `focus-order-stable` | Tab walk の全 stop が意味のある要素で、supporting element（`body` / `html`）に一度も落ちない | Chromium: walk の途中で `body` に落ちたら終了し、落ちた位置と tag を `end` として記録する |
| `focus-order-ends-at-document` | Tab walk は「上限に達した」のではなく、**文書末尾で終わる**（focus が `body` へ返る） | Chromium: `end` が `null` ではなく `tag === 'BODY'` |
| `focus-order-forward` | focus は文書順に進む（前の stop に戻らない）。戻った = 途中で focus を失い、Tab 順が先頭から再開した | Chromium: 各 stop の文書内並び位置（`querySelectorAll('*')` の index）が単調増加 |
| `focus-order-wraps` | 文書末尾のあとで Tab すると先頭へ戻る（Tab 順が巡回する） | Chromium: `body` に落ちた直後の 1 回の Tab が最初の stop に戻る |
| `focus-order-reversible` | Shift+Tab が逆順に歩く | Chromium: 2 回目の Tab の要素と Shift+Tab 後の要素の比較 |
| `nav-reachable` / `nav-activatable` | nav の link に Tab で到達でき、Enter で遷移する | Chromium: `toBeFocused()` + URL 変化 |
| `menu-escape-returns-focus` | mobile menu が Escape で閉じ、**trigger へ focus が戻る** | Chromium: Escape 後の `toBeFocused()` |
| `dialog-traps-focus` | `<dialog>` を開いている間、Tab を重ねても focus が dialog の外へ出ない | Chromium: 12 回の Tab の各点で `dialog.contains(activeElement)` |
| `dialog-is-modal` | picker の `<dialog>` は **modal** である（`showModal()` で開かれている）。非 modal（`show()`）では、dialog が focus を持っていても 12 回の Tab が dialog 内にとどまるため、上の assertion では気づけない | Chromium: `dialog.matches(':modal')` |
| `dialog-tab-targets-are-its-own` | Tab の行き先は **dialog 内の focus 可能要素**である（dialog 以外の要素へ Tab しない） | Chromium: 各 Tab の `activeElement` が dialog 内の focus 可能要素（`a[href]` / `button` / `input` / `select` / `textarea` / `[tabindex]`。disabled を除く）に含まれるか |
| `dialog-escape-returns-focus` | Escape で dialog が閉じ、trigger へ focus が戻る | Chromium: `toBeHidden()` + `toBeFocused()` |
| `dialog-surface-is-known` | このリポジトリの `<dialog>` はリアクション picker だけである | Chromium: `dialog` 要素の `aria-label` を全件検査 |
| `dialog-fixture-contract` | **key 不要の surface**（`/design-system` の fixture）で、出荷している picker の dialog が focus を拘束し、Escape で閉じ、trigger へ focus を戻す | Chromium: fixture の trigger に focus して Enter → 12 回の Tab が外へ出ない → Escape で `toBeHidden()` → trigger が `toBeFocused()` |

### 人が評価すること（機械では判定しない）

- focus ring の**見た目**（視認性・コントラスト・200 % ズームでの見え方）
- 実際のスクリーンリーダー読み上げ（VoiceOver / NVDA）と MCA（読み上げ）順序の体感
- フォーカスされた面の読みやすさと疲労感
- キーボードだけで「意図した操作」に到達できているかの体感

これらは検証画像にも同じ文言で印字され、`docs/verification/a11y/keyboard-navigation.webp`
の evidence panel にも「human evaluation (not measured here)」として
列挙される。

## negative control（検査が「見ていない」状態の排除）

正常な実装だけで緑にすると、assertion が何も見ていない可能性が残る。
そのため **意図的に壊したケースを同じ spec の中に 3 つ** 用意し、
そのケースで assertion が赤になることを確認している（negative control は
**必ず成功する**。赤になると assertion が機能していないことを示す）。
production コードは書き換えず、実行時に DOM を一時的に壊すだけ。

| negative control | 壊し方 | 赤になる assertion |
| --- | --- | --- |
| skip link を外す | `document.querySelector('a[href="#main"]')?.remove()` を実行時に実行 | 「最初の Tab stop が `#main` か」。壊す前に通ることと、壊した後に赤になることを spec 内で両方 assert する |
| menu trigger を外す | 開いた状態で `nav[aria-label="Public"] button[aria-controls]` を実行時に除去してから Escape | 「Escape 後に focus が trigger へ戻ったか」。trigger が無いので `toBeFocused()` が必ず失敗する |
| 途中で focus を失う | 3 個目の stop の要素を実行時に DOM から除去し、focus を body へ落とす | 「focus が文書順に進んでいるか」（`focus-order-forward`）。Tab が先頭から再開するため並び位置が越小になり、walk の assertion が赤くなる |

3 つめは **F2 の指摘**（supporting element に対する検査が構造的に常に
真だった）への回答でもある。supporting element は walk の**終端条件**で
あって stop には混ざらないため、「stop が supporting element ではない」
という検査は守るものがなかった。代わりに walk が**どう終端したか**
（`end`）と **focus が前に戻らなかったか**（`forward`）を観測し、
その 2 つを assert している。

## attack（壊し方を入れたときに赤になることの確認）

negative control に加えて、**出荷コード側を実際に壊したとき**に
assertion が赤くなることを、修正を戻す前に確認した（attack）。
壊した内容は作業用ブランチの commit には含まれない。

| attack | 壊したもの | 結果 |
| --- | --- | --- |
| A | `src/editorial/nav/PublicNav.tsx` の Escape 後の focus 復元（`buttonRef.current?.focus()`）を無効化 | `/about` の mobile menu の test が **赤**（`the focus must return to the trigger that opened the menu` / focus は `<BODY>` にいた）。同じ修正を入れると緑 |
| B | `src/home/reactions/widget.tsx` の `<dialog>` の Escape handler（`onKeyDown`）を無効化 | `/design-system` の fixture の dialog test が **赤**（`expect(locator).toBeHidden() failed` = Escape で閉じない）。同じ修正を入れると緑 |
| C | `src/home/reactions/widget.tsx` の `dialog.showModal()` を `dialog.show()` に置き換え（**非 modal** にする） | `/design-system` の fixture の dialog test が **赤**（`the shipped picker dialog must be modal (opened with showModal()) (SC 2.1.2)`）。`showModal()` に戻すと緑。modal 性を失っても「12 回の Tab が dialog 内に留まる」は緑のままになるため、この attack は `dialog-is-modal` assertion が有効であることを示す |

attack A は「修正 **(a)** が本当に効いている」ことを、attack B は
「**dialog の focus 契約が key なしで検査されている**」ことを示す。

## スクリーンショット

成果物は `docs/verification/a11y/keyboard-navigation.webp`（PNG はリポジトリに
置いていない）。Issue #394 の「PRの必須スクリーンショット」は
`docs/verification/a11y/keyboard-focus-sequence.png` を要求している。成果物の
ファイル名と拡張子は Issue の指定と **2 点で異なる**ので、理由を分けて
書いておく（読者が別々に追えるようにするため）。

| 乖離 | Issue の指定 | 成果物 | 理由 |
| --- | --- | --- | --- |
| ファイル名 | `keyboard-focus-sequence.png` | `keyboard-navigation.webp`（名前部分 = `keyboard-navigation`） | Issue は「focus sequence」と書いているが、本 PR の主題は nav / mobile menu / dialog / tools 入口という **キーボード契約全体** であり、focus の並びだけではない。成果物の名前を `keyboard-navigation` に改めた |
| 拡張子 | `.png` | `.webp` | 本リポジトリの capture script は **WebP のみ**（`.png` の出力パスを拒否する。既存の `capture-a11y-table-code.mjs` と同じ扱い）。Chromium の PNG を `sharp` で WebP に変換し、中間 PNG は削除する |

- 生成: `pnpm run capture:a11y-keyboard-nav`
- 対象: ローカルの preview server（`scripts/e2e-local-bootstrap.mjs`、Playwright の
  `webServer` と同じ経路）が serve した **実際の Worker**。fixture は使わない
- 左: `/` の 1280 × 900 / deviceScaleFactor 2 の描画。**skip link に focus が
  当たっている状態**（focus ring が見える。skip link は focus されるまで
  画面外へ translate される）
- 右: 記録した Tab 順の一覧（何番目に何が focus したか）と、機械検査の結果
  （skip link の focus ring の視認性、Tab 順の巡回、mobile menu の Escape での
  focus 戻し、picker dialog の **modal 性** / Tab 行き先が dialog 内の focus
  可能要素であること / focus 拘束 / Escape での閉鎖と trigger への focus 戻し）
- 上部: 検証レポート（WCAG 対応・機械検査項目・人間の評価項目）
- 失敗条件: 観測がキーボード契約と矛盾した場合、**成果物を書かずに exit 1**
  （見栄えのよい画像だけが残ることを防ぐ）

## 検証コマンド

```bash
pnpm run a11y:keyboard-nav:check    # Playwright のキーボード回帰検査（gate）
pnpm run capture:a11y-keyboard-nav   # Chromium で実測して WebP を生成
node --test scripts/capture-a11y-keyboard-nav.test.mjs  # capture の判定関数の単体テスト
pnpm exec vitest run src/editorial/nav/PublicNav.test.ts
pnpm run bundle:budget:check         # fixture 追加後のルート予算
pnpm run format:check && pnpm run lint:check && pnpm run architecture:check
```

`pnpm run a11y:keyboard-nav:check` は preview server を必要とするが、
Playwright の `webServer` が自動起動する（`dist/client` が必要な場合は先に
`pnpm run build`）。

## 誤検知が起きたときの対応

機械検査は **構造** だけを判定する。誤検知（偽陽性）が起きた場合は、次の順で
対処する。どの判断も **gate の閾値を緩めることで済ませない**。

1. **その assertion は本当にその route で成立する性質か。** 本 spec の
   assertion は route ごとに決まるもので、どの route にも共通して成り立つ
   構造を測る。`/` の Tab walk が測るのは「すべての stop が
   インタラクティブ要素で、focus が文書順に進み、文書末尾で `BODY` へ
   落ちる」という性質であり、特定の route の内容には依存しない。逆に、
   **内容に依存する** assertion（公開行の順序、件数、日次で変わる一覧）を
   route をまたいで足すと、その assertion は誤検知の温床になる。
2. **日付・データ・設定に依存する副作用か。** 誤検知が起きうる主な例は
   次の 3 つであり、いずれも **assert しない** 方向で処理済みである。
   - `/portfolio` / `/portfolio/[slug]`: 公開行の有無で Tab 順が変わる
     （対象外表に明記済み）。
   - `/contact`: channel 一覧が 30 日の鮮度窓で入れ替わるため、本 spec は
     件数・順序・文言を assert せず、skip link への到達だけを見る。
   - `/tools`: 「公開されている Tool が 1 件以上ある」は公開状態に依存する。
     さらに dialog 側は home consumer API key の有無で 2 つの状態になる
     （key あり = full 契約 / なし = 「reactions disabled」注記のみ。
     どちらの分岐も明示的に assert し、skip はしない）。
3. **その route を対象外表に足すか、対象を狭めるか。** 対象外表
   （`## 対象外（理由つき）` の表）に **route と理由** を書いて除外する。
   理由の無い除外は成立しない。spec 側で除外する場合は、describe を
   丸ごと消すのではなく、**その route で成立する assertion だけを残す**
   （skip ではなく、状態を明示的に表明する形にする）。
4. **gate の閾値を緩めて緑にする手順は禁止。** `MIN_TAB_STOPS` を下げる、
   Tab の回数を減らす、`isFocusInside` の条件を緩める、といった変更で
   「緑にした」を報告してはならない。**対象の拡大縮小は本 doc に宣言して
   から** コードを変える（どの性質をどの程度緩めるのか、どの route を
   対象外にするのかを書く）。宣言しない閾値の緩和は、その assertion が
   何も見ていないことを隠す。
5. **いずれも該当しない場合は owner へ判断を仰ぐ。** 判断が要るのは、
   「この route を対象外にしてよいか」「この性質は gate の対象から外して
   よいか」のように、**検査対象そのものの範囲**が変わる場合である。

なお、本 spec の assertion は negative control（3 件）と attack（3 件）で
「赤になれること」を確認済みなので、誤検知の報告には **どの assertion が
どの route で落ちたか** を添えること。

## 既知の制約・残件

- **`<dialog>` を持つ surface は 1 つだけ**（`src/home/reactions/widget.tsx`
  のリアクション picker）。この picker は home consumer API key
  （`MY_WEB_2026_CONSUMER_API_KEY`）が設定された deployment でのみ描画され、
  未設定の deployment では「reactions disabled」という注記だけになる。
  そのため spec は **2 つの状態を明示的に assert する**（skip はしない）:
  picker がある環境では dialog の full 契約（focus 拘束・Escape 解除・
  focus 復帰）、ない環境では「disabled 注記が出ていて `<dialog>` が 0 個」
  という documented な状態。どちらの分岐もローカルで実測済みである。
  さらに **key 不要の fixture**（`/design-system` の「05 — Interactive」
  セクション内の fixture）があるため、
  dialog の focus 契約は **key の有無にかかわらず** 必ず CI で走る
  （「dialog の focus 契約は key 未設定環境では未検証」という記録だけ
  を残す選択肢 (c) は採らない。採らない理由は、**記録が残ると CI が
  何も検査しないまま終わる**ためで、代替 (a) が可用だった）。
  本番（key 設定済み）での dialog 契約は、既存の
  `e2e/prod-smoke.spec.ts` が picker 自体の操作を Production Smoke として
  カバーしている。
- **focus ring の見た目は本 Issue の対象外**（#399 / 人が評価）。
  本 spec が確かめるのは「focus が可视状態にある」ことまで。
- **`/contact` の channel 一覧は日次で変わる**（30 日の鮮度窓）ため、
  個数・順序・文言は assert しない。キーボードで到達できること
  のみを見る。
- **`<main>` 自体は focusable ではない**ため、skip link の Enter 後に
  `activeElement` が body になる（Chrome は sequential focus navigation
  の開始点だけを main へ移す）。したがって spec は「URL の fragment が
  `#main` になること」と「次の Tab が `<main>` 内から始まること」を
  見る。focus を main の要素自身へ移す実装（`tabindex="-1"`）は別の
  Issue の決定事項。
