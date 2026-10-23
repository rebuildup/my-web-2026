# モーダル / メニューの焦点管理と復帰を検証する（Issue #406）

> 検証対象: 既存の公開 route `/design-system` に mount した **出荷している
> リアクション picker の `<dialog>`**（`src/home/reactions/widget.tsx` の
> `PickerModal`）。
> 判定の物差しは [WCAG 2.2](https://www.w3.org/TR/WCAG22/) の
> **SC 2.1.2 No Keyboard Trap（A）/ SC 2.4.3 Focus Order（A）/
> SC 2.4.7 Focus Visible（AA）**。他の SC は混ぜない。

本 Issue は **実在するモーダルの焦点契約を測り、その契約を静的に固定する**
もので、新しい画面は作らない。測定は
`pnpm run capture:a11y-dialog-focus`、静的検査は
`pnpm run a11y:dialog-focus:check`。

## 対象（実在するモーダル / メニューの列挙）

| 種別 | 実在するもの | 本 gate の扱い |
| --- | --- | --- |
| ネイティブ `<dialog>` | `src/home/reactions/widget.tsx` の `PickerModal`（1 件） | **対象**。静的 gate が列挙し、契約を読む。Chromium 実測もこの 1 件を駆動する |
| `role="dialog"` / `aria-modal` | 0 件 | 対象（rule はあるが、出荷コードに該当なし） |
| popover（`popover` 属性） | 0 件 | 対象外（実在しない） |
| menu ボタン（`aria-haspopup` / `role="menu"`） | 0 件 | 対象外（実在しない） |
| 開閉メニュー（`aria-expanded` + `aria-controls`） | `src/editorial/nav/PublicNav.tsx` の mobile menu（disclosure） | **対象（静的 gate のみ）**。gate が列挙し、`Escape` で閉じる menu に focus hand-back が無いと違反にする。**browser 実測はしない**（runtime の実測は Issue #394 の `e2e/a11y/keyboard-navigation.spec.ts` が既に担っている） |

「実在しないもの」は作らない。fixture は **既存 primitive の組み合わせ**で
状態を再現する申し立てであり、出荷 component をコピーしない。

## 実測した結論（推測ではなく Chromium の観測）

Issue は「`open` 属性で開いているため focus が戻らない可能性」を疑っていた。
**実測では再現しなかった。** 出荷している `PickerModal` は
`dialog.showModal()` で開き `dialog.close()` で閉じる実装であり、
ネイティブ dialog の UA 契約（focus trap / `Escape` / focus 復帰）を
そのまま受けている。

| 観測 | 出荷 component | 注入した欠陥（`showModal` → `show`） |
| --- | --- | --- |
| `dialog.matches(':modal')`（modal である） | **true** | false |
| Tab 12 回の間 focus が dialog 内に留まる | **true** | true（※非 modal でも dialog 内に focus 可能要素があるため。だからこそ `:modal` の assertion が要る） |
| 背景の control が focus を取れない（inert） | **true** | false |
| `Escape` で閉じる | **true** | false |
| 閉じたあと focus が起動要素（trigger）へ戻る | **true** | false |

つまり **出荷側の修正は不要**だった。本 Issue の成果は、この契約を
**静的 gate と browser 実測の 2 段で固定し、退行（`open` 属性へ戻す /
close 経路を消す / 独自実装で focus を戻さない）を赤にする**ことである。

### 起動要素へ戻ることの根拠

`showModal()` は「呼び出し直前の focused element」を記憶し、`close()` は
それを focus し直す（UA の挙動）。実測の `document.activeElement` は
`Escape` 後に `<BUTTON data-testid="design-system-reaction-picker-open">` に
戻っており、上の表のとおりである。

## 適用対象 / 対象外 / 基準

### 適用対象

| 対象 | 範囲 | 備考 |
| --- | --- | --- |
| `src/**/*.{ts,tsx}` | 出荷する JSX / TS のすべて | ネイティブ `<dialog>` と custom modal の宣言を読む |
| ネイティブ `<dialog>` | `open` 属性 / `showModal()` / close 経路 | 契約は「`showModal()` で開き、閉じる経路がある」 |
| custom modal | `role="dialog"` / `aria-modal="true"`（`<dialog>` 以外の要素） | 契約は「`document.activeElement` を保存し `.focus()` で戻す」 |
| 開閉メニュー（disclosure） | `aria-expanded` の trigger ＋ `hidden` の panel を持ち、`Escape` で閉じるもの | 契約は「閉じたあとに trigger へ focus を戻す」 |

### 対象外（理由つき）

| 対象外 | 理由 |
| --- | --- |
| `*.test.ts` / `*.test.tsx` | テストは描画を検証するファイルであり、除去すべき欠陥は出荷コード側にある |
| `*.stories.tsx` | Storybook の story はコンポーネントのプレビュー用ハーネスであり、訪問者が到達する表面ではない（コンポーネント本体は別途走査される） |
| `**/fixtures/**` | fixture は形を持つために存在し、本 gate が拒否する形も含む |
| `src/routes/design-system/**` | リポジトリ内部のコンポーネントギャラリーであり、公開表面ではない。**出荷している picker を mount する**が、component 本体は `src/home/reactions/widget.tsx` で走査される |
| mobile menu の **runtime** 実測（browser） | 静的 gate は menu の契約を宣言する。menu を **ブラウザで駆動する**測定は Issue #394 の `e2e/a11y/keyboard-navigation.spec.ts` が既に担っているため、本 PR は重複して作らない |
| `popover` 属性 / `role="menu"` | 出荷コードに 0 件（実在しないものは作らない） |
| focus ring の見た目（コントラスト・視認性） | 機械では判定しない。Issue #399 の gate と人が評価する |
| スクリーンリーダーの読み上げ・MCA 順序 | 機械では判定しない。人が評価する |

### 基準

| 基準 | レベル | 該当箇所 | 判定方法 |
| --- | --- | --- | --- |
| SC 2.1.2 No Keyboard Trap | A | モーダルを開いている間の focus 拘束、閉じる経路、背景の inert | Chromium 実測（`:modal` / Tab 12 回 / 背景 focus / `Escape`）+ 静的 gate（`showModal()` と close 経路の宣言） |
| SC 2.4.3 Focus Order | A | 閉じたあとの focus 復帰（起動要素へ） | Chromium 実測（`document.activeElement`）+ 静的 gate（custom modal の focus-return 契約） |
| SC 2.4.7 Focus Visible | AA | focus ring の**見た目** | 機械では判定しない（#399 / 人が評価） |

## 判定する rule

| rule | 意味 | 判定 |
| --- | --- | --- |
| `dialog-non-modal-open` | ネイティブ `<dialog>` を `open` 属性 / `show()` で開いている（UA の focus trap も focus 復帰も無い） | 違反 |
| `dialog-close-path-missing` | `showModal()` で開く modal に閉じる経路（`close()` / `onClose` / `onCancel` / `cancel`・`close` listener / key handler）が無い | 違反 |
| `custom-dialog-focus-return-missing` | custom modal（`role="dialog"` / `aria-modal`）に focus-return 契約（`document.activeElement` の保存 + `.focus()`）が無い | 違反 |
| `menu-focus-return-missing` | 開閉メニュー（disclosure）が `Escape` で閉じるのに、閉じたあとに trigger へ focus を戻す宣言が無い。panel が `hidden` になると focused element が accessibility tree から消え、focus が body に落ちる（SC 2.4.3 / SC 2.1.2） | 違反 |
| `fixture-pass-no-case` / `fixture-pass-violation` / `fixture-fail-not-detected` / `fixture-fail-unexpected` / `fixture-file-missing` / `fixture-file-unexpected` | fixture の目録と実体・期待の整合 | 違反（gate 自身の整合性） |

## fixture

`scripts/fixtures/a11y-dialog-focus/` は gate 自身が読む。`pass/` は違反 0、
`fail/` は期待 rule をちょうど 1 つ報告しなければならない。fixture は
**closed set** で、1 個欠けても（`fixture-file-missing`）緑にはならない。

| ファイル | 属 | 再現する状態 |
| --- | --- | --- |
| `pass/native-modal-contract.tsx` | pass | `showModal()` + `close()` + `onClose` のネイティブ modal |
| `pass/custom-modal-with-focus-return.tsx` | pass | `role="dialog"` + `document.activeElement` 保存 + `.focus()` 復帰 |
| `pass/menu-with-focus-return.tsx` | pass | `aria-expanded` trigger ＋ `hidden` panel、`Escape` で閉じて trigger へ focus を戻す disclosure menu |
| `fail/dialog-open-attribute.tsx` | fail | `open` 属性で開く（非 modal）→ `dialog-non-modal-open` |
| `fail/dialog-non-modal-show.tsx` | fail | `show()` で開く（非 modal）→ `dialog-non-modal-open` |
| `fail/dialog-no-close-path.tsx` | fail | `showModal()` があるが閉じる経路が無い → `dialog-close-path-missing` |
| `fail/custom-modal-no-focus-return.tsx` | fail | `role="dialog"` で focus-return 契約が無い → `custom-dialog-focus-return-missing` |
| `fail/menu-no-focus-return.tsx` | fail | `Escape` で閉じるが focus hand-back が無い disclosure menu → `menu-focus-return-missing` |

## 機械検査と人間の評価の区別

### 機械検査（`pnpm run a11y:dialog-focus:check` / `pnpm run capture:a11y-dialog-focus`）

| 検査 | 内容 | 判定方法 |
| --- | --- | --- |
| `dialog-non-modal-open` | 出荷コードに `open` 属性 / `show()` で開く `<dialog>` が無い | コメント除去後のソース走査 |
| `dialog-close-path-missing` | `showModal()` で開く modal に閉じる経路がある | 同上 |
| `custom-dialog-focus-return-missing` | custom modal に focus-return 契約がある | 同上 |
| `menu-focus-return-missing` | 開閉メニューが `Escape` で閉じるときに focus hand-back の宣言がある | 同上（コメント除去後のソース走査） |
| fixture の再現 | `pass/` は違反 0、`fail/` は期待 rule ちょうど 1 | 同上（gate 自身が行う） |
| dialog が modal である | `dialog.matches(':modal')`（`showModal()` で開いている） | Chromium 実測（capture） |
| focus が dialog 内に留まる | Tab 12 回の各点で `dialog.contains(document.activeElement)` | Chromium 実測 |
| 背景が inert | 背景の focus 可能要素へ `.focus()` しても `document.activeElement` が変わらない | Chromium 実測 |
| `Escape` で閉じる | `Escape` 後に `dialog.isHidden()` | Chromium 実測 |
| focus が起動要素へ戻る | `Escape` 後の `document.activeElement` が trigger（`data-testid`）である | Chromium 実測 |

### 人間の評価（機械では判定しない）

- focus ring の**見た目**（視認性・コントラスト・200 % ズームでの見え方）
- 実際のスクリーンリーダー読み上げ（VoiceOver / NVDA）と MCA 順序
- dialog 内の Tab 順が読み順と一致しているかの体感
- modal が開いている間、背景が支援技術に対して inert であることの実機確認

これらは検証画像にも同じ文言で印字され、`docs/verification/a11y/dialog-focus.webp`
の evidence panel にも「human evaluation (not measured here)」として列挙される。

## negative control（検査が「見ていない」状態の排除）

正常な実装だけで緑にすると、assertion が何も見ていない可能性が残る。
capture は **同じ測定を 2 回** 走らせる:

1. 出荷している `PickerModal` をそのまま駆動 → 契約を満たす（緑）。
2. `HTMLDialogElement.prototype.showModal` を `show` に差し替えて
   **非 modal で開く欠陥を注入** → `evaluateObservation` が **赤**（4 件の
   failure: 非 modal / 背景が inert でない / `Escape` で閉じない /
   focus が戻らない）。

2 回目が緑になったら、capture は「assertion が modal 契約を見ていない」と
して **成果物を書かずに exit 1** になる（緑の画像を残さない）。

## attack（壊し方を入れたときに赤になることの確認）

出荷コード側を実際に壊したときに gate が赤になることを確認した。壊した
内容は commit に含まれない。

| attack | 壊したもの | 結果 |
| --- | --- | --- |
| A | `src/home/reactions/widget.tsx` の `dialog.showModal()` を `dialog.show()` に置き換え（非 modal にする） | `pnpm run a11y:dialog-focus:check` が **exit 1**（`dialog-non-modal-open`）。`pnpm run capture:a11y-dialog-focus` も **exit 1**（`:modal` が false / 背景が inert でない / `Escape` で閉じない / focus が戻らない）で成果物を書かない |
| B | `fail` fixture の期待 rule を 1 つ減らす | gate が **exit 1**（`fixture-fail-not-detected`） |
| C | `src/home/reactions/widget.tsx` の `dialog.close()` と `onClose` を消す（閉じる経路を無くす） | `pnpm run a11y:dialog-focus:check` が **exit 1**（`dialog-close-path-missing`） |
| D | `src/editorial/nav/PublicNav.tsx` の `Escape` ハンドラから trigger への `.focus()` を外す（menu の focus hand-back を無くす） | `pnpm run a11y:dialog-focus:check` が **exit 1**（`menu-focus-return-missing`） |

注入はすべて revert 済み（`git status --porcelain` が空）。

## スクリーンショット

成果物は `docs/verification/a11y/dialog-focus.webp`（PNG はリポジトリに
置いていない）。Issue #406 の「必須スクリーンショット」は
`docs/verification/a11y/dialog-focus-return.png` を要求している。成果物の
ファイル名と拡張子は Issue の指定と **2 点で異なる**ので、理由を分けて
書いておく。

| 乖離 | Issue の指定 | 成果物 | 理由 |
| --- | --- | --- | --- |
| ファイル名 | `dialog-focus-return.png` | `dialog-focus.webp`（名前部分 = `dialog-focus`） | Issue は「return」と書いているが、本 PR の主題は focus の復帰だけでなく **trap / 背景 inert / `Escape` を含む modal の焦点契約全体** である。成果物の名前を `dialog-focus` に改めた |
| 拡張子 | `.png` | `.webp` | 本リポジトリの capture script は **WebP のみ**（`.png` の出力パスを拒否する。既存の `capture-a11y-table-code.mjs` と同じ扱い）。Chromium の PNG を `sharp` で WebP に変換し、中間 PNG は削除する |

- 生成: `pnpm run capture:a11y-dialog-focus`
- 対象: ローカルの preview server（`scripts/e2e-local-bootstrap.mjs`）が
  serve した **実際の Worker** の `/design-system`。fixture は使わない
  （`/design-system` の Issue #394 fixture が mount するのは出荷している
  `PickerModal` であり、コピーではない）
- 左: 開いている picker dialog の描画（1280 × 900 / deviceScaleFactor 2）
- 右: 機械検査の結果（`:modal` / focus 拘束 / 背景 inert / `Escape` での
  閉鎖 / 起動要素への focus 復帰 / negative control の判定）と、人間の評価の
  一覧
- 上部: 検証レポート（WCAG 対応・機械検査項目・人間の評価項目）
- 失敗条件: 観測が焦点契約と矛盾した場合、**成果物を書かずに exit 1**
  （見栄えのよい画像だけが残ることを防ぐ）

## 検証コマンド

```bash
pnpm run a11y:dialog-focus:check       # 静的 gate（fast gate の一部）
pnpm run capture:a11y-dialog-focus     # Chromium で実測して WebP を生成
node --test scripts/check-a11y-dialog-focus.test.mjs
node --test scripts/capture-a11y-dialog-focus.test.mjs
```

capture は preview server を必要とする（`dist/client` が必要な場合は先に
`pnpm run build`）。

## 誤検知が起きたときの対応

機械検査は **構造** だけを判定する。誤検知（偽陽性）が起きた場合は、次の順で
対処する。どの判断も **gate の閾値を緩めることで済ませない**。

1. **その宣言は本当にモーダルか。** `open` 属性で開く `<dialog>` は
   **非モーダル**であり、モーダルではない（例: 通知、インラインの詳細）。
   モーダルでないなら対象外である。対象外にするには、その surface と理由を
   本 doc の「対象外」表に書く（理由の無い除外は成立しない）。
2. **close 経路は本当に無いか。** `close()` を helper 経由で呼んでいる、
   `onClose` を spread で渡している、といった書き方は、いまの
   `hasClosePath` では検出できない。その場合は検出器を広げる（`close()`
   呼び出しの別名を読む）のであって、rule を消さない。
3. **custom modal の focus 復帰は別の形か。** `document.activeElement` を
   保存せず、`inert` 属性や `focus()` の別名で戻している実装は、検出器を
   広げる対象である。
4. **gate の閾値を緩めて緑にする手順は禁止。** rule を消す、`open` 属性を
   許可する、close 経路の判定を外す、といった変更で「緑にした」を報告しては
   ならない。対象の拡大縮小は本 doc に宣言してからコードを変える。
5. **いずれも該当しない場合は owner へ判断を仰ぐ。** 判断が要るのは、
   「この surface を対象外にしてよいか」「この宣言を gate の対象から外して
   よいか」のように、**検査対象そのものの範囲**が変わる場合である。

## 既知の制約

- **ネイティブ `<dialog>` は 1 つだけ**（`src/home/reactions/widget.tsx` の
  `PickerModal`）。この picker は home consumer API key
  （`MY_WEB_2026_CONSUMER_API_KEY`）が設定された deployment でのみ home に
  描画されるため、capture は **key 不要の `/design-system` fixture** で
  同じ component を駆動する（Issue #394 と同じ方式）。
- **focus ring の見た目は本 Issue の対象外**（#399 / 人が評価）。
  本 gate が確かめるのは「focus が trap され、戻る」ことまで。
- **background inert の判定は「背景の focus 可能要素へ `.focus()` しても
  `document.activeElement` が変わらない」** という観測である。支援技術に
  対する inert の実機確認は人評価に残す。
- **開閉メニュー（disclosure）は静的 gate の対象**だが、**browser 実測は
  しない**。menu の focus hand-back は Issue #394 の
  `e2e/a11y/keyboard-navigation.spec.ts` が runtime で実測している。本 gate
  は「menu が `Escape` で閉じるときに focus hand-back の宣言があるか」を
  静的に読み、出荷コードの退行を PR 時に止める。
- **`showModal` / `show` の差し替えで注入した欠陥は capture の中で完結する**
  （出荷コードは書き換えない）。
