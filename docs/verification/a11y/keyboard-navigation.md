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

## 適用対象

| route | URL | viewport | ブラウザ | 観測するもの |
| --- | --- | --- | --- | --- |
| Home | `/` | 1280 × 720（Playwright の Desktop Chrome 既定） | Chromium | skip link が最初の Tab stop / Enter で main へ / Tab walk 全体で focus を見失わない / Shift+Tab が逆順 / 唯一の `<dialog>` |
| About（nav opt-in page） | `/about` | 1280 × 720 | Chromium | ヘッダー nav の link に Tab で到達でき、Enter で遷移する |
| About（mobile menu） | `/about` | 600 × 800 | Chromium | menu が Enter で開き、Escape で閉じて **focus が trigger に戻る** |
| Tools | `/tools` | 1280 × 720 | Chromium | Tools 入口の link に Tab で到達でき、Enter でその Tool の画面へ遷移する |
| Contact | `/contact` | 1280 × 720 | Chromium | skip link に Tab で到達できる（channel 一覧は日次で変わるため件数や順序は固定しない） |

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
| `/design-system` | デザインシステムの見本画面であり、利用者の主要導線ではない |
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
| `focus-order-stable` | Tab walk の全 stop が意味のある要素で、supporting element（`body` / `html`）に一度も落ちない | Chromium: walk の途中で `body` に落ちたら終了し、落ちた位置を記録 |
| `focus-order-wraps` | 文書末尾のあとで Tab すると先頭へ戻る = 途中で focus を見失っていない | Chromium: `body` に落ちた直後の 1 回の Tab が最初の stop に戻る |
| `focus-order-reversible` | Shift+Tab が逆順に歩く | Chromium: 2 回目の Tab の要素と Shift+Tab 後の要素の比較 |
| `nav-reachable` / `nav-activatable` | nav の link に Tab で到達でき、Enter で遷移する | Chromium: `toBeFocused()` + URL 変化 |
| `menu-escape-returns-focus` | mobile menu が Escape で閉じ、**trigger へ focus が戻る** | Chromium: Escape 後の `toBeFocused()` |
| `dialog-traps-focus` | `<dialog>` を開いている間、Tab を重ねても focus が dialog の外へ出ない | Chromium: 12 回の Tab の各点で `dialog.contains(activeElement)` |
| `dialog-escape-returns-focus` | Escape で dialog が閉じ、trigger へ focus が戻る | Chromium: `toBeHidden()` + `toBeFocused()` |
| `dialog-surface-is-known` | このリポジトリの `<dialog>` はリアクション picker だけである | Chromium: `dialog` 要素の `aria-label` を全件検査 |

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
そのため **意図的に壊したケースを同じ spec の中に 2 つ** 用意し、
そのケースで assertion が赤になることを確認している（negative control は
**必ず成功する**。赤になると assertion が機能していないことを示す）。
production コードは書き換えず、実行時に DOM を一時的に壊すだけ。

| negative control | 壊し方 | 赤になる assertion |
| --- | --- | --- |
| skip link を外す | `document.querySelector('a[href="#main"]')?.remove()` を実行時に実行 | 「最初の Tab stop が `#main` か」。壊す前に通ることと、壊した後に赤になることを spec 内で両方 assert する |
| menu trigger を外す | 開いた状態で `nav[aria-label="Public"] button[aria-controls]` を実行時に除去してから Escape | 「Escape 後に focus が trigger へ戻ったか」。trigger が無いので `toBeFocused()` が必ず失敗する |

## スクリーンショット

`docs/verification/a11y/keyboard-navigation.webp`（Issue #394 が指定する
`keyboard-navigation.png` の WebP 版。PNG はリポジトリに置いていない）。

- 生成: `pnpm run capture:a11y-keyboard-nav`
- 対象: ローカルの preview server（`scripts/e2e-local-bootstrap.mjs`、Playwright の
  `webServer` と同じ経路）が serve した **実際の Worker**。fixture は使わない
- 左: `/` の 1280 × 900 / deviceScaleFactor 2 の描画。**skip link に focus が
  当たっている状態**（focus ring が見える。skip link は focus されるまで
  画面外へ translate される）
- 右: 記録した Tab 順の一覧（何番目に何が focus したか）と、機械検査の結果
- 上部: 検証レポート（WCAG 対応・機械検査項目・人間の評価項目）
- 失敗条件: 観測がキーボード契約と矛盾した場合、**成果物を書かずに exit 1**
  （見栄えのよい画像だけが残ることを防ぐ）

## 検証コマンド

```bash
pnpm run a11y:keyboard-nav:check    # Playwright のキーボード回帰検査（gate）
pnpm run capture:a11y-keyboard-nav   # Chromium で実測して WebP を生成
pnpm exec vitest run src/editorial/nav/PublicNav.test.ts
pnpm run format:check && pnpm run lint:check && pnpm run architecture:check
```

`pnpm run a11y:keyboard-nav:check` は preview server を必要とするが、
Playwright の `webServer` が自動起動する（`dist/client` が必要な場合は先に
`pnpm run build`）。

## 既知の制約・残件

- **`<dialog>` を持つ surface は 1 つだけ**（`src/home/reactions/widget.tsx`
  のリアクション picker）。この picker は home consumer API key
  （`MY_WEB_2026_CONSUMER_API_KEY`）が設定された deployment でのみ描画され、
  未設定の deployment では「reactions disabled」という注記だけになる。
  そのため spec は **2 つの状態を明示的に assert する**（skip はしない）:
  picker がある環境では dialog の full 契約（focus 拘束・Escape 解除・
  focus 復帰）、ない環境では「disabled 注記が出ていて `<dialog>` が 0 個」
  という documented な状態。どちらの分岐もローカルで実測済みである。
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
