# 361do の命名解釈 — brand naming note

> Status: **Internal brand naming note**（Issue #521）
> Visibility: repository-internal。この Note のうち「公開案（短い説明の候補）」の節だけが、外部に出してよい文案の **候補** を持つ。
> Audience: contributor, agent, future-self
> Source: Issue #521 本文（唯一の典拠）

361do という名前には、まだ決着していない複数の読み方がある。この Note はその読み方を **1 つに統一しない**。
5 つの解釈は互いに競合し得るので、どちらも消さずに記録として残す。どれか一つを正式設定（正式名）と決めることは、この Note の範囲外であり、行っていない。

この Note が残すのは **名前** の解釈と、その説明文の案までである。名前に対応する **シンボル / mark** は、この repository に存在しない（後述）。symbol に関する決定は Issue #61 の責務であり、本 Note では作らない。

---

## 典拠と前提
<!-- preview: public -->

- 典拠は Issue #521 の本文のみ。Miro の付箋（個人 > samuido > 361do > 命名の複数解釈）にはアクセスできない。
- Miro にしかない情報（各解釈の背景や motivation）は創作せず、「未確認（owner 確認待ち）」と記す。
- 361do 自体は docs/personal/domain.md の canonical statement による「samuido と同じ人物の stylized / numeric identity」。
- 「do」の由来は本 Note の典拠からは確認できない（未確認（owner 確認待ち））。
- 5 つの解釈は並列の候補であり、どれか一つを正式設定として確定していない。
- 関連 Issue #380（機能独立の preview 契約）と #381（技術説明の独立ページ）は参照するが、hard dependency ではない。

## 解釈 1 — 360°回ってさらに一歩先
<!-- preview: public -->

- 原案（Issue #521 本文の表記）: 360°回ってさらに一歩先
- 読み: 360°をひと回りしたあとに、さらに一歩。
- 機械的に導ける根拠: 361 = 360 + 1。一周分を超えて 1 増える。
- 背景・意図: 未確認（owner 確認待ち）
- 採否: 保留。5 案のどれかを正式設定にする決定は行っていない。

## 解釈 2 — 361℃
<!-- preview: public -->

- 原案（Issue #521 本文の表記）: 361℃
- 読み: 数値 361 を摂氏（℃）の温度として読む。
- 機械的に導ける根拠: 361 = 360 + 1。解釈 1 と同じ数値関係で、単位だけが温度。
- 背景・意図: 未確認（owner 確認待ち）
- 採否: 保留。

## 解釈 3 — 361回
<!-- preview: public -->

- 原案（Issue #521 本文の表記）: 361回
- 読み: 数値 361 を回数として読む。
- 機械的に導ける根拠: 361 = 360 + 1。
- 背景・意図: 未確認（owner 確認待ち）
- 採否: 保留。

## 解釈 4 — 360でも365でもない
<!-- preview: public -->

- 原案（Issue #521 本文の表記）: 360でも365でもない
- 読み: 360 でも 365 でもない、という否定の形で 361 を選ぶ。
- 機械的に導ける根拠: 360 / 365 という定数を「使わない」と明示した表現。361 = 360 + 1。
- 背景・意図: 未確認（owner 確認待ち）
- 採否: 保留。

## 解釈 5 — 19²
<!-- preview: public -->

- 原案（Issue #521 本文の表記）: 19²
- 読み: 19 の 2 乗。
- 機械的に導ける根拠: 19 × 19 = 361。数値 361 を 2 つの数の積として自己記述する。
- 背景・意図: 未確認（owner 確認待ち）
- 採否: 保留。

## 公開案（短い説明の候補）
<!-- preview: public -->

- 案 A（数値のみ・解釈に中立）: 361do — 361 という数字で名付けた personal identity。
- 案 B（解釈 1「360°回ってさらに一歩先」を前面に）: 360°をひと回りして、その先へもう一歩。361do — samuido と同じ人物の stylized identity。
- 案 C（用途から説明する）: 361do — samuido と同じ人物の stylized identity。BOOTH などの配布・販売と、361do_sleep / 361do_design の social handle で使われる。
- 3 案とも候補であり、どの案を公開するかは未決（owner 確認待ち）。
- この preview は design-system 配下の fixture であり、公開ページには載っていない。

## シンボルとアセット
<!-- preview: public -->

- 361do に対応する mark / symbol asset はこの repository に存在しない。
- public/favicon.svg は Issue #285 の placeholder（純青の円）。scripts/generate-app-icons.mjs がそこから app icon を生成する。361do の mark ではない。
- public/og/default-card.png は rebuildup.dev の fallback card（src/editorial/social-card/contract.json が正）。
- したがってこの preview のシンボルは「未定義」と表示する。
- 新しい SVG / シンボル asset は本 Note では作らない（Issue #61 の asset 採否と重複する）。

## Issue #61 とのスコープ分離
<!-- preview: public -->

- Issue #61: favicon / app icon / header / OG 等の brand asset の採否を決める。
- Issue #521（本 Note）: 名前の解釈と、その説明文の案。
- 本 Note は asset を作らない・採否を決めない。asset 側の判断は Issue #61 のまま。
- 「名前」と「シンボル」は別の決定であり、片方の決定を他方の根拠にしない。

## 内部検討（未公開）
<!-- preview: held -->

この節は **内部検討** であり、公開 preview には出さない。公開 preview に出ているのは上の「公開案（短い説明の候補）」だけである。preview 側にこの節の文言が混入していないことは `scripts/check-brand-name-meanings-preview-parity.test.mjs` が検査する。

### 長文の説明文の草稿

- 草稿 A（数値の読みから入る）: 「360°をひと回りして、その先へもう一歩。361do は samuido と同じ人物の stylized identity で、配布・販売や social handle の名前に現れる。」— 解釈 1 を前提にするため、解釈 1 が採用されない場合は使えない。
- 草稿 B（人物から入る）: 「361do は samuido と同じ人物を指す別の呼び名。BOOTH などの配布・販売面と、361do_sleep / 361do_design のような用途別の social handle で使われる。」— 解釈を一つも前提にしないが、名前が何を指すかの説明に留まる。

### 未決事項

- 5 つの解釈のうち、どれを（あるいはどれを）外部の説明文に反映するか。
- 「361do」を visitor-facing な第一表示名として使うか。docs/personal/domain.md では第一表示名は samuido、361do は stylized / distribution identity として整理されている。この Note はその整理自体を動かさない。
- 名前とシンボルを別のアセットとして扱うか、1 つの identity として扱うか。symbol 側は Issue #61 が決定的である。

### 不採用案の扱い

Issue #521 は「不採用案を含む note」を求めている。しかし現時点で **採用・不採用のいずれも確定していない** 5 案しか存在しない。判定保留（保留）として記録し、owner が決定した後に「不採用」として追記する。本 Note が不採用を宣言することはしない。

## 検証方法
<!-- preview: held -->

- 一致検証: `node --experimental-strip-types --test scripts/check-brand-name-meanings-preview-parity.test.mjs`（`pnpm run test` が `scripts/*.test.mjs` を discovery する）。
- 撮影: `node scripts/capture-brand-name-meanings.mjs`（shipped story module を Vite harness で描画し、Playwright で fullPage スクリーンショットを撮って WebP 化し、`docs/verification/brand/361do-name-meanings.webp` に書く）。
- preview: `src/personal/brand-naming/BrandNameMeanings.stories.tsx`（story id `personal-brand-naming-brandnamemeanings--standard`）。
- preview データ: `src/personal/brand-naming/BrandNameMeanings.preview.ts`。
- 状態: 標準 / 空 / 狭幅 の 3 状態。Issue #380 の preview 契約が挙げる「失敗」状態は、この Note が外部依存を持たない静的な記録であるため該当しない。
