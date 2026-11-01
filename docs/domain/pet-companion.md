# Pet companion — Codex ペット (Melty) の Web 再利用

> Status: **設計改訂中 — 配置契約を 2026-11-01 に全面改訂（owner 2 次指示）**
> Visibility: public (MIT)
> Audience: contributor, agent, future-self
> Owner: rebuildup（§1 owner attestation）
> Issue: #274
> Enforced by: `assets:license:check`（`quality/asset-license-inventory.json#pet-melty-sprites`）、
> `a11y:reduced-motion:check`、`a11y:image-alt:check`、`copy:i18n:check`

## 1. 結論

- 素材は**失われていない**。`~/Documents/Codex/2026-10-07/pets-plugin-work-pets-openai-curated/`
  に v2 スプライトアトラスと生成・検証の全成果物が残っている。期限切れだったのは
  `spritesheet_url`（署名付きの転送用一時 URL）だけで、素材そのものはローカルの Library 側にある。
- 権利は owner の申告（attestation）として記録した。
  **「Melty は owner のオリジナルキャラクターで、owner のアイコンでもある」**（2026-11-01）。
  記録は [`quality/asset-license-inventory.json`](../../quality/asset-license-inventory.json)
  の `pet-melty-sprites`。根拠と未確認項目は
  [`docs/verification/legal/pet-melty-rights-review.md`](../verification/legal/pet-melty-rights-review.md)。
- 表示は **セクション内ではなく、ページ全体に対する浮遊レイヤー**。Home と `/about` の
  2 面が同じ `editorial` プリミティブ（`src/editorial/pet/PetSprite.tsx`）を描く。
  どのセクションにも属さず、読み順・見出し構造・本文の流れに入らない（§5.2）。
- この文書は「素材は何か」「どう出しているか」「何が未確認か」を記録する。
  **実装の正本はコード**であり、この文書はその判断理由を持つ。

## 2. 素材の実体（証拠）

発見場所（この Mac のローカル。リポジトリ外）:

```text
~/Documents/Codex/2026-10-07/pets-plugin-work-pets-openai-curated/outputs/Pets/Melty/
```

| ファイル | 寸法 | バイト | sha256 |
| --- | --- | ---: | --- |
| `final/spritesheet-extended.png` | 1536 × 2288（v2） | 1,546,230 | `78aa007c7d183e6087593463d77297bb0c707368f9c05cd871145281bbf63902` |
| `final/spritesheet.png` | 1536 × 1872（v1） | 1,225,950 | `31d1b8ab26c90d7747eb1a7a36a5cfb098bbd1fcb6e7244754c348400a1f4471` |
| `final/spritesheet-extended-raw.png` | 1536 × 2288（despill 前） | 1,548,910 | `c4bb4ae5662f6409b464519a1a6bdeb6d95c88a47db628f437efd0af6ea988a8` |

付随する記録:

| ファイル | 内容 |
| --- | --- |
| `pet-record.json` | `id: pet_6ac5adc2388481919ad57cc91ead3f51` / `name: Melty` / `sprite_version: 2` / `selected: true` |
| `final/validation-extended.json` | `ok: true`, `errors: []`, `warnings: []`, 8 列 × 11 行, `sprite_version_number: 2`, 透明 RGB 残渣 0 px |
| `qa/pet-quality.json` | `ok: true`, `errors: []`。look 方向の連続性に 4 件の警告（§3.2） |
| `qa/final-contact-sheet.png` | 全 11 行のコンタクトシート（目視確認済み） |
| `qa/final-previews/*.gif`, `*.mp4` | 状態ごとのループ、全状態、idle→jump→idle |
| `qa/blind-*.json` | 方向のブラインド判定 |

`~/.codex/config.toml` の `selected-avatar-id` はこの `pet_id` と一致する。
つまりこの Mac の Codex デスクトップは今も Melty を選択しており、
実体は「消えた」のではなく「`~/.codex/pets/` とは別の場所に保存されていた」。

### 2.1 なぜ `~/.codex/pets/` が空なのか

`~/.codex/pets/` は空である（確認済み）。一方、`work-pets` プラグインの契約は
「ペットの成果物は ChatGPT Library に保存する」と定めており
（`~/.codex/plugins/cache/openai-curated-remote/work-pets/0.1.6/references/sprite-sheet-contract.md`
§Save artifacts to Library）、この Library の実体が上記 `~/Documents/Codex/**` である。
`~/.codex/pets/` の役割はこの調査では特定していない（空だったという事実だけを記録する）。

### 2.2 失うと再現できないもの

アトラスの再生成は画像生成モデルに依存し、**決定的ではない**。
同じプロンプトでも同じバイトは出ない。したがって
`final/spritesheet-extended.png` は 1 点物として扱う。

このリポジトリは**アトラスを commit しない**（§5.9）。代わりに
`scripts/build-pet-sprites.mjs` が sha256 で固定しており、記録と違うアトラスは拒否する。
つまりリポジトリはバイトを保存していないので、**Library 側の原本が失われると再生成できない**。
Library 外へのバックアップは owner の作業として残っている（§8）。

## 3. アトラス契約（v2）

セルは **192 × 208 px**、8 列固定。各状態は行の左端セルから並ぶ。

| Row | 状態 | フレーム | 意味 |
| ---: | --- | ---: | --- |
| 0 | idle | 6 | 静かな呼吸・まばたきのループ |
| 1 | running-right | 8 | 画面右向きの移動 |
| 2 | running-left | 8 | 画面左向きの移動 |
| 3 | waving | 4 | 手を振る挨拶 |
| 4 | jumping | 5 | 上昇して基準線に戻る |
| 5 | failed | 8 | 失敗の反応 |
| 6 | waiting | 6 | 承認・入力待ち |
| 7 | running | 6 | 処理中・作業中 |
| 8 | review | 6 | 成果物の確認 |
| 9 | look 000–157.5 | 8 | 視線方向（前半） |
| 10 | look 180–337.5 | 8 | 視線方向（後半） |

未使用セルは完全透明。合計 73 フレーム + 15 透明セル = 88 セル。

### 3.1 Web で出荷している行

| 行 | 出荷 | 使う場所 |
| --- | --- | --- |
| 0 idle | 第 0 フレーム | 静止状態 |
| 1 running-right | 8 フレーム | 右方向へドラッグ中 |
| 2 running-left | 8 フレーム | 左方向へドラッグ中 |
| 3 waving | 4 フレーム | 到着時の挨拶（1 回だけ） |
| 9 look 000 / 090 | 2 セル（上・右） | ポインタ接近・スクロール方向の視線 |
| 10 look 180 / 270 | 2 セル（下・左） | 同上 |
| 4 jumping | 出荷しない | 採らない理由は §5.4 |
| 5 / 6 / 7 / 8 | 出荷しない | サイトに「作業中 / 失敗 / 確認待ち」の状態が無い。偽の状態を演じることになる |

look 行は 16 方位すべてではなく **4 方位に量子化**して出荷する（§5.4）。

### 3.2 既知の警告

`qa/pet-quality.json` は look 方向の連続性に 4 件の警告を出している
（`157.5→180` が局所外れ値、`292.5→315` / `337.5→000` が隣接平均より大きい差分）。
契約上これは warning であり、cardinal / quadrant の誤りではない。

出荷している行（0 / 1 / 2 / 3）はこの警告の対象外。look 行からは
**cardinal の 4 セル（000 / 090 / 180 / 270）だけ**を使う（§5.4）。
警告が指しているのは隣接フレーム間の差分であり、cardinal セル自体の向きではない。
連続ループとして look 行を再生する判断をした場合にだけ再評価する。

## 4. 権利（確定）

`src/legal/contract.ts` の語彙に沿った記録は
`quality/asset-license-inventory.json` の `pet-melty-sprites` にあり、
導出結果は **`publishable`**（findings 0 件）。要点:

| 項目 | 値 | 根拠 |
| --- | --- | --- |
| `origin` | `repository-authored` | owner が自身のオリジナルとして作成・所有していると申告（2026-11-01） |
| `rightsHolder` | `rebuildup` | 同上 |
| `license.spdx` | `NOASSERTION` | 資産単位の SPDX は owner が決めていない。**捏造しない** |
| `verification.method` | `repository-evidence` | 申告の記録（権利レビュー文書）がリポジトリ内にある |
| `publication` | `published` | owner が公開可と判断 |

`L018`（第三者を同梱 + `NOASSERTION` → `hold`）は `origin` が repository 系のため
発火しない。**この 1 点が判定の要**で、`origin` を `third-party-bundled` に戻せば
`hold` に戻る。

未確認のまま残した項目（提供者条件の本文、資産単位の SPDX、第三者確認）は
[`docs/verification/legal/pet-melty-rights-review.md`](../verification/legal/pet-melty-rights-review.md) §5。

## 5. 統合設計（実装済み）

### 5.1 所有権の置き場所 — `src/editorial/pet/`

当初案（`src/home/pet/`）は**昇格トリガを自分で書いていた**:
「2 つ目の消費者が現れ、かつ表示とは独立した契約が観測されたとき、
`editorial` か新 obligation かを再判断する」。owner が Home と `/about` の
2 面を指定した時点でこのトリガが成立した。

AGENTS.md §3 の 5 問（現状の答え）:

| 問い | 答え |
| --- | --- |
| Obligation | キャラクターの**表示**（寸法・フレーム・反応の選択・ドラッグ・reduced-motion 分岐） |
| Change reason | キャラクターの見せ方が変わるとき。ページの主張が変わっても変わらない |
| Authority | `src/editorial/**`（出荷済みの視覚言語）と reduced-motion 契約 |
| Dependency direction | `home → editorial` / `about → editorial`（どちらも §3 の許可済みエッジ）。**新しいエッジは 1 本も追加していない** |
| Lifecycle | 視覚言語と共に生まれ、共に消える |

`/about` は `routes → about → editorial` しか持てない（`about` から `home` は禁止）。
したがって 2 面で共有する表示プリミティブの置き場所は `editorial` 以外にない。
`src/pet/` のような新しい top-level obligation は作っていない — 独立した
authority / lifecycle が観測されていないため。

物理配置:

```text
src/editorial/pet/
  PetSprite.tsx          浮遊レイヤー本体（配置・ドラッグ・反応・reduced-motion 分岐）
  position.ts            保存位置の読み書きとクランプ（純関数、storage は注入）
  PetSprite.test.tsx     マークアップ / 反応 / ドラッグ / storage の契約
  position.test.ts       クランプと壊れた保存値の扱い
  PetSprite.stories.tsx  Interactive / ReducedMotion / BothPreferences
  index.ts               re-export
```

アセットは `public/pets/melty/`（§5.8）。

### 5.2 配置契約 — セクションではなくページの浮遊レイヤー

owner 指示（2026-11-01、`OWNER-2026-11-01-2.md`）:

> ペットはセクションに制限せず、自由に上から重ねる形式にする。

2026-11-01 の初版は Home の `05 — Companion` セクションと `/about` の hero 右カラムに
置いていた。**この配置は廃止した。** セクション所属は「そのページの内容の一部」という
主張になり、実際にはどのページの本文でもないものを、Home の情報設計に混ぜていた。

現在の契約:

| 項目 | 契約 |
| --- | --- |
| 所属 | **どのセクションにも属さない。** ページの本文フロー・見出し階層・読み順に入らない |
| 位置 | `position: fixed`。スクロールに追従し、本文の流れから独立する |
| 実体 | **スプライトの実体（96 × 104 CSS px）ちょうどの 1 ボックス**。全画面の透明レイヤーは敷かない |
| ポインタ | `pointer-events` はそのボックスにだけ乗る。下のリンク・ボタン・スクロールは奪わない |
| 初期位置 | 画面右下（`inset-block-end` = **同意面の公開値 + 12 px（= 面の可視上端 + 24 px）**、最低 72 px / `inset-inline-end: 24px`） — 下端だけ持ち上げる理由は直後と §5.2.1 |
| 面 | Home（`src/home/composer.tsx`）と `/about`（`src/about/components/AboutPage.tsx`）。同じコンポーネントを 1 個ずつ描く |
| 重なり順 | `z-index: 30`（同意バナーの 20 より上、モーダルはこのリポジトリに無い） |

初期位置を参照元の既定（右上・§5.9）と変えている理由: このサイトは上部に
sticky なヘッダがあり、右上に浮かせるとナビゲーションの上に乗る。読み列は中央なので、
**右下が本文から最も遠い**。

ただし**左下ではなく右下の、下端から 72 px** を初期位置にする。24 px の素の右下では、
解析同意のトグル（`src/editorial/analytics/AnalyticsConsent.tsx` の
`data-testid="analytics-consent-toggle"`、下端 12 px・高さ 36 px）の右上に
キャラクターの当たり判定が重なった — 装飾が実在のボタンの一部を奪う状態で、
要件 4 に反する。実測（1440 × 900、Playwright）で pet の矩形は
`y 811.5–876.0`、トグルは `y 852–888`、重なりは 24 px。
`REST_INSET_BLOCK_END = 24 + 36 + 12` でトグルの 12 px 上に置くと重なりは 0 になる。
**初期位置だけ**を持ち上げる: 訪問者がドラッグした位置は訪問者のもので、
その上に自分でコントロールを置くのは取り消せる行為だから。

セクションを消した副作用として、Home の eyebrow 連番は `05 — Contact` に戻した
（`06 — Contact` ではない）。`src/home/composer.tsx` の reading-order コメントも同期。

### 5.2.1 同意面との結合（Issue #783）

Issue #783 は同意パネルを**下辺全幅の帯**にする。帯は `position: fixed` で高さが
実測 198 px（1440 幅）/ 341 px（390 幅）あり、素の休息位置（下 72 px）は帯の**内側**に落ちる。
390 幅では帯の操作ボタンが全幅で縦積みになるため、装飾が「許可する / 拒否する」を覆う。

同意面は既に `--analytics-consent-offset`（`src/editorial/analytics/consent.ts`
が名前を持ち、`AnalyticsConsent.tsx` が `:root` に publish する）で
**自面の高さ + 12 px**（focus compensation 用の余白込み）を公開している。
ペットはその**読み手**になるだけでよい。

```text
休憩時の block-end = max(72px, var(--analytics-consent-offset, 0px) + 12px)
```

| 同意面の状態 | 面の高さ | publish される値 | 休憩時の block-end | 帯の上端との間隔 |
| --- | ---: | ---: | ---: | ---: |
| 無し（SSR / hydration 前 / 対象外ページ） | — | 無し（0） | **72 px** | — |
| 畳んだピル（判断済み） | 36 | 48（36 + 12） | **72 px**（60 < 72 なので従来どおり） | 24 px（下端 828 / ピル上端 852） |
| 帯（未確定、1440） | 198 | 210 | **222 px** | **24 px**（下端 678 / 帯上端 702） |
| 帯（未確定、390） | 341 | 353 | **365 px** | **24 px**（下端 479 / 帯上端 503） |

- publish 値は既に 12 px を含むため、式の `+ 12px` を足すと帯の可視上端からは
  **24 px** 空く。12 px で足りるかは見た目の判断なので、実測値として
  `docs/verification/visual/pet-companion/consent-*.webp` と
  `.tmp/pet-consent/measurements.json` に残し、owner / supervisor に返す。

- `max()` であって和ではない。ピルは 60 なので 72 に戻り、帯だけが押し上げる。
  式は `src/editorial/pet/position.ts` の `restingBlockEndInset()` が唯一の実装で、
  CSS 側に第 2 の式は置かない（サーバ文書は定数 72 px で描き、hydration 後にだけ
  この関数の値へ移る）。
- 値は **hydration 後**に読む。最初の描画ではまだ公開されていないので、
  サーバは 72 px で描き、マウント直後に一度だけ上へ移る（`transform` のみ遷移するので
  アニメーションはせず、位置が飛ぶだけ）。同意面自体も hydration 後に出るので、
  訪問者から見れば「同意面が出た瞬間にペットがその上へ退く」順序になる。
- 途中で形が変わった場合（帯 → ピル、ピル → 帯）は `MutationObserver`（`:root` の
  `style`）と `resize` で読み直す。位置が既にある場合は**新しい移動可能域へクランプ**
  し直すので、形が変わった後も同意面の下に残らない。
- **ドラッグの移動可能域も同じ下端を使う。** 以前は下端 24 px まで動かせたので、
  訪問者が帯の上へ運べてしまっていた。`blockEnd` を休憩インセットにしたことで、
  帯があるときは帯の上までしか動かせない。訪問者が置いた位置を尊重する原則
  （§5.2）は「同意面の上」の範囲でだけ適用される。
- `pet-position.v1` は**移動可能域に対する比率**なので、箱の高さが変わっても
  同じ相対位置に戻る。帯が出た後に復元すると「下」は「帯の直上」を意味する。
- `--pet-overlay-offset`（focus compensation、§5.6）も同じ値で再 publish する:
  `blockEnd + 104`。実測では同意面なし / ピルが 176 px、帯（1440）が 326 px、
  帯（390）が 469 px。

### 5.3 退避 — 本文を覆い続けない

要件 4「本文を邪魔しない」と禁止事項「自動で本文の上に被さり続けてリンクを隠す挙動」に
対して、位置ではなく**大きさ**で答える。

| 状態 | 大きさ | 入る条件 / 出る条件 |
| --- | --- | --- |
| 休憩 | 0.62 倍（約 60 × 64 px、原点は右下） | 既定。最後の反応から 12 秒 |
| 反応中 | 1.0 倍（96 × 104 px） | ポインタが 120 px 以内 / スクロール / ドラッグ / 到着の挨拶 |

- 休憩サイズが**既定**なので、何もしない読者の上には小さい姿しか乗らない。
- 拡大は 200 ms の `transform` 遷移。reduced motion では拡大そのものを行わない（§5.5）。
- `transform: scale()` はヒットテストにも効くので、休憩中は**実際に受けるポインタ領域も**小さくなる。
- 12 秒は「読みながら横切られない長さ」と「読み終えた行を覆わない長さ」の折衷。
  値はこの文書が正本で、実装は `REST_AFTER_MS` として同じ値を持つ。

### 5.4 反応 — ボタンを持たない

owner 指示:

> そしてユーザーの操作に対して自動で反応するように。ボタンなどを使わずに。

反応の対象は「本人が今やっていること」に限る。**UI は作らない**（ボタン、ツールチップ、
設定パネル、バッジ、クリックでの再生）。

| # | 反応 | トリガ | 見た目 | なぜ読者の役に立つか |
| ---: | --- | --- | --- | --- |
| 1 | 到着の挨拶 | そのページで最初に描画されたとき 1 回 | `waving` 4 フレーム / 0.7 秒 | ボタンもツールチップも無いので、「これは意図された相棒で、操作対象ではない」ことを最初の 1 回で伝えられる。貼り付いた画像との区別がこれ 1 つでつく |
| 2 | スクロール方向の視線 | 24 px 以上のスクロール | `look-down`（下へ）/ `look-up`（上へ）を 0.9 秒 | 読み進めている方向を小さく肯定する。反応していることが分かると、装飾は「置物」ではなくその場の一部になる。**走らせない**ので、移動していないのに移動しているようには見せない |
| 3 | ポインタ接近の視線 | ポインタが 120 px 以内 | その方位の `look-*` を保持 | 参照元の signature（§5.9）。ポインタを奪わず、クリックも要求しない。視線だけなので操作の圧力を与えない |
| 4 | ドラッグ | 掴んでいる間 | `running-right` / `running-left` 8 フレームのループ + `cursor: grabbing` + `shadow.md` | 掴めたことと、どちらへ運ばれているかが出る。**実際に移動している**ので、走る絵は嘘ではない |

**採らない反応**（理由付き）:

| 参照元の挙動 | 採否 | 理由 |
| --- | --- | --- |
| ホバーで `jumping` | 採らない | ホバーは既に視線で使っている。横切るたびに跳ねるのは読者の操作と無関係な自動運動で、WCAG 2.2.2 の精神（勝手に動き続けない）に反する。跳ねると位置が実際のアンカーからずれ、「置物の位置」を偽る |
| 通知 / ターン状態の `running` / `waiting` / `failed` / `review` | 採らない | このサイトには「作業中」「失敗」「確認待ち」の状態が無い。無い状態を演じるのは偽装 |
| ドラッグ解放の慣性・バウンド | 採らない | 読者が置いた位置から勝手に滑る。保存位置と実際の位置が食い違い、次回の復元も合わなくなる |
| クリックで開く（参照元は Quick Chat を開く） | 採らない | owner の「ボタンなどを使わずに」に反する |
| 待機時間で別の姿勢に変わる | 採らない | 読者の役に立たない。タイマーが増えるだけで、可読性も変わらない |
| 全 16 方位の視線（22.5° 刻み） | 一部採る（4 方位） | 16 方位を出すには look 行 2 本（16 フレーム、約 60 kB）を出荷する必要がある。装飾に対して過大。「近づいた方を見る」は 4 方位で成立する |

### 5.5 reduced motion

`src/editorial/reduced-motion.ts` の契約（Issue #403）に従う。

| 対象 | `prefers-reduced-motion: reduce` のとき |
| --- | --- |
| 到着の挨拶 / スクロール視線 / ポインタ視線 | **行わない。** 自動反応はすべて止める |
| ドラッグ | **残す。** 直接操作なので止めない |
| ドラッグ中の見た目 | `running` ストリップを出さず、静止フレームのまま `cursor: grabbing` + `shadow.md`（動かない状態表示） |
| 休憩 ↔ 反応の拡大 | 拡大しない（休憩サイズのまま）。200 ms 遷移も出さない |

- **描画時**の判定は `usePrefersReducedMotion()`（`useSyncExternalStore`、SSR スナップショットは
  `false`）。描画中に `resolveReducedMotion()` を直接呼ぶと、サーバが送っていない
  マークアップを最初のクライアント描画で作ってしまう（`CounterTile` と同じ理由で採らない）。
- **effect 内**では実値を読む。サーバは「motion allowed」で描くので、最初のクライアント描画の
  `reducedMotion` はまだ `false` であり、それを描画の値のまま信じると
  **reduced の訪問者に挨拶のタイマーが 1 回だけ走る**。`useEffect` の初回で
  `resolveReducedMotion(override)` を呼び直してから開始するので、挨拶は
  hydration 後にしか始まらず、reduced では始まらない（2026-11-01 の実機確認で
  この分岐が無いと `waving` のまま止まることを検出し、修正した）。
- 拡大（0.62 → 1.0）も自動反応の 1 つなので reduced では行わない。休憩サイズのまま
  一定で、`transform` の 200 ms 遷移も走らない。
- `a11y:reduced-motion:check` は `animation:` 宣言を含む region ごとに
  `data-motion` フックと preference の呼び出しを要求する。reduced でアニメーション要素を
  DOM に出さない実装にしても、CSS 層の opt-out として
  `src/styles.css` の `[data-motion="pet-reaction"] { animation: none !important; }` を残す。

### 5.6 キーボード / 支援技術

| 対象 | 扱い |
| --- | --- |
| ルート要素 | `aria-hidden="true"`。`role` なし、`tabindex` なし |
| 画像 | `alt=""`（装飾）。`a11y:image-alt:check` の PASS 形 |
| フォーカス | **しない。** ボタンが無いのでフォーカス可能な子孫も無い |
| キーボード操作 | 提供しない。位置の変更はポインタ操作の副産物で、キーボード利用者はこの装飾を必要としない |
| フォーカス済み要素の遮蔽 | WCAG 2.2 SC 2.4.11。`--pet-overlay-offset`（**現在の**下端インセット + フレーム 104 px。同意面が無ければ 72 + 104 = 176 px、帯（1440）なら 222 + 104 = 326 px、帯（390）なら 365 + 104 = 469 px）を mount 中だけ publish し、`src/styles.css` の `:root { scroll-padding }` と `body { padding-bottom }` が `max()` で消費する。`scripts/check-a11y-focus-visible.mjs` が両端の存在を強制する |

「不可視」は読み上げ・フォーカスの話で、視覚的にも消すという意味ではない
（owner は相棒として見せることを求めている）。`aria-hidden` を付けた要素の中に
フォーカス可能な要素を置くと不正になるので、**将来ここにボタンを足してはいけない**。

### 5.7 保存位置

- `localStorage` のキー `pet-position.v1`。値は
  `{"xRatio":number,"yRatio":number}`（0–1、可動域 = viewport − 96×104 − インセット
  に対する比率）。比率で持つので、ウィンドウサイズが変わっても、同意面の形が
  変わって下端が動いても（§5.2.1）、同じ**相対位置**に戻る。
- 読み書きは `try/catch`。storage が無い / 壊れた JSON / 範囲外の値は**既定位置**に落ちる。
  `position.ts` がその判定を持つ（純関数。storage は引数で受け取る）。
- 復元は `useEffect`（クライアントのみ）。SSR と最初のクライアント描画は同じ既定位置
  なので hydration mismatch は起きない。保存位置がある場合は**復元時に 1 回だけ位置が飛ぶ** —
  これは受け入れる（レイアウトは固定ボックスなので CLS 0）。
- 保存はドラッグ終了時のみ。ドラッグ中の各移動では書かない。

### 5.8 寸法・転送量・配信

- **初期 JS に含めない。** ページが import するのは `PetCompanion`
  （`src/editorial/pet/PetCompanion.tsx`）だけで、hydration 後に
  `import('./PetSprite')` する。サーバ文書と最初のクライアント描画は空。
  装飾のために全 route の first paint を払わない、という
  `quality/bundle-budget.json` の判断であり、見た目の要件（到着時の挨拶・
  スクロールの視線・ドラッグ）は遅延読み込みでも満たされる。チャンク取得に
  失敗した場合はペットが居ないだけ（装飾の正しい失敗）。
- 表示はセル 192 × 208 を **96 × 104 CSS px**（DPR 2 で原寸 1:1）。72 × 78 は 2 倍系でないので輪郭が甘くなる。
- 出荷ファイル（`scripts/build-pet-sprites.mjs`、`pnpm run generate:pets`）:

| ファイル | 行 | フレーム | 元寸法 | 使うとき |
| --- | ---: | ---: | --- | --- |
| `idle-rest.webp` | 0 | 1 | 192 × 208 | 常時 |
| `waving.webp` | 3 | 4 | 768 × 208 | 到着時 |
| `look-up.webp` / `look-down.webp` | 9 / 10 | 1 | 192 × 208 | スクロール |
| `look-left.webp` / `look-right.webp` | 10 / 9 | 1 | 192 × 208 | ポインタ接近 |
| `running-right.webp` / `running-left.webp` | 1 / 2 | 8 | 1536 × 208 | ドラッグ中 |

  実測値は `docs/verification/legal/pet-melty-rights-review.md` と
  `quality/asset-license-inventory.json#pet-melty-sprites` の `publicPaths` に同期する。
- `<img>` は**現在の姿勢の 1 枚だけ**を mount する。初期転送は idle（約 4.5 kB）+ 挨拶
  （約 15 kB）で、look / running はその姿勢になったときに初めて取りに行く。
- 全イメージ `loading="lazy"` `decoding="async"` `fetchpriority="low"`。固定ボックス
  （`width` / `height` 属性 + CSS）で **CLS 0**。
- 出力先は `public/pets/melty/`。**`src/**` から import しない**。Vite に取り込むと
  `/assets/<hash>` になり `assets:license:check` の監査対象から外れる（Issue #780）。
- 変換は `scripts/build-pet-sprites.mjs`: 入力アトラスの sha256 を固定値で検証し、
  一致しなければ**何も書かずに失敗する**。出力は 1 回 encode の決定的結果。

### 5.9 参照元（Codex デスクトップのペット）の実挙動 — 一次情報

owner は「実際のCodexペットのように」と**参照元を名指し**している。以下は推測ではなく、
この Mac にある配布物の文字列と、ペット生成プラグインの契約文書から確認した事実である。
確認できなかったことは「確認できなかった」と書く。

一次情報:

1. `/Applications/ChatGPT.app/Contents/Resources/app.asar`（Codex デスクトップの
   avatar overlay を含む配布物。`avatar-overlay-*`、`data-codex-pet-*` の文字列を持つ）
2. `~/.codex/plugins/cache/openai-curated-remote/work-pets/0.1.6/`
   （`references/sprite-sheet-contract.md`、`skills/create-pet/references/animation-rows.md`、
   `skills/create-pet/scripts/prepare_pet_run.py`）

| 挙動 | 一次情報 | 採否 |
| --- | --- | --- |
| デスクトップの上に浮く overlay。寸法は 80–224 px、既定 112 px | 設定項目 `avatar-overlay-mascot-width-px`「Size of the floating Codex pet」、`avatar-overlay-pet-visible`「Whether the floating Codex pet is visible above its controls」 | **採る**（浮遊。寸法はこのサイトの 96 × 104） |
| 既定は右上（`placement="top-end"`）、ドラッグ後は自由配置 | 既定値 `placement="top-end"`、フラグ `isFreelyPositioned` | **採る**（ただし初期位置は右下。§5.2 の理由） |
| ドラッグで移動し、移動方向に応じて `running-right` / `running-left` に切り替わる。しきい値 4 px | `(Math.abs(r)>=4||Math.abs(i)>=4)&&(…,r>=4?\`running-right\`:r<=-4&&\`running-left\`)`、`avatar-overlay-drag-start` / `-move` / `-end` | **採る**（しきい値も同じ 4 px） |
| 位置は永続化される | electron-store のキー `electron-avatar-overlay-bounds` | **採る**（`localStorage`、比率で保存） |
| ポインタの方位を 16 方位（22.5° 刻み）で見る | `Math.atan2(r,-i)…`、`A7i=22.5,j7i=16`、look 行は 9/10、中心からの距離が 1 px 以下なら idle | **一部採る**（4 方位に量子化。§5.4） |
| ホバーで `jumping` | `respondToHover` → `f = i && c ? 'jumping' : s`、`onPointerEnter` | **採らない**（§5.4） |
| 通知 / 作業状態で `running` / `waiting` / `failed` / `review` に変わる | `mascotState` の割り当て（loading→running、warning→waiting、danger→failed、success→review） | **採らない**（サイトに状態が無い） |
| ドラッグ解放で慣性・バウンド | `avatar-overlay-drag-release` + `throwWithVelocity(…, shouldBounce)` | **採らない**（§5.4） |
| 装飾時の `aria-hidden="true"` | スプライト要素の `"aria-hidden": "true"`（ラベルが付くのは操作可能なときだけ） | **採る**（このサイトでは常に装飾） |
| 実体だけがポインタを受ける（ウィンドウ側のマウスパススルー） | `applyPointerInteractivityPolicy`、`mousePassthroughMode`、`setPointerInteraction(id, isInteractive)` | **採る**（Web では「スプライト実体サイズの fixed ボックスにだけ `pointer-events`」で等価） |
| クリックで Quick Chat を開く | `avatar-overlay-action`（`focus-quick-chat`） | **採らない**（ボタン禁止） |
| スクロールへの反応 | `app.asar` 内の scroll リスナとペットの結びつきは**確認できなかった** | **こちらで追加する**（§5.4 #2）。参照元はチャット窓の上に浮くが、このサイトは長い文書の上に浮く。参照元では「ターン状態」が読者の進行の代理だった |

確認できたが**採らなかった**もののうち、`jumping`（row 4）は将来の候補として残すが、
「押せる / 操作できる」方向の反応を足すときは §5.6 のフォーカス禁止と衝突するので、
まず owner に返す。

契約文書側の補足: `animation-rows.md` は row 1/2 を「drag movement loop」、
row 4 を「hover or playful jump」と定義しており、app.asar の実装と一致する。
`prepare_pet_run.py` のプロンプトも row 1/2 を "Dragging-right/left loop" と呼ぶ。
つまり **running 行はドラッグ専用**という扱いは参照元の設計そのものである。

## 6. 実装ファイル一覧

| ファイル | 役割 |
| --- | --- |
| `src/editorial/pet/PetCompanion.tsx` | ページが import する静的側の入口（hydration 後に `PetSprite` を dynamic import） |
| `src/editorial/pet/PetSprite.tsx` | 浮遊レイヤー本体（配置・ドラッグ・反応・reduced-motion 分岐） |
| `src/editorial/pet/position.ts` | 保存位置の読み書き・クランプ（純関数、storage は注入） |
| `src/editorial/pet/PetSprite.test.tsx` | 装飾 / 寸法 / ドラッグ / 自動反応 / reduced / storage 不可の契約 |
| `src/editorial/pet/PetCompanion.test.tsx` | サーバ文書と最初のクライアント描画が空であること |
| `src/editorial/pet/position.test.ts` | クランプと壊れた保存値の扱い |
| `src/editorial/pet/PetSprite.stories.tsx` | `Editorial/PetSprite`（3 story） |
| `src/editorial/pet/index.ts` | re-export |
| `src/editorial/reduced-motion.ts` | `PET_REACTION_MOTION` |
| `src/styles.css` | `[data-motion="pet-reaction"]` の opt-out |
| `panda.config.ts` | `petReaction` / `petRun` keyframes（`petRun` は両方向で 1 本。違いはストリップだけ） |
| `docs/verification/visual/pet-companion/overlay-verification.md` | 実機で撮った WebP と測定値（§5.2 の重なり回避を含む） |
| `src/home/composer.tsx` | ページ末尾に `<PetSprite />`（セクションは持たない） |
| `src/about/components/AboutPage.tsx` | 末尾に `<PetSprite />`（hero 右カラムから移動） |
| `public/pets/melty/*.webp` | 出荷バイト（§5.8） |
| `scripts/build-pet-sprites.mjs` | アトラス → ストリップ変換（digest 固定） |
| `quality/asset-license-inventory.json` | `pet-melty-sprites` レコード |
| `docs/verification/legal/pet-melty-rights-review.md` | 権利の根拠と未確認項目 |

## 7. 残っている作業（この Issue の範囲外）

1. **原本の退避** — Library 外へのバックアップは owner の作業（§2.2）。
   リポジトリはバイトを保存しない。
2. **`AUDITED_ROOTS` の隙間** — `src/**` から Vite が配信するバイトが
   権利監査の対象外。Issue #780（target 0.9.0）として起票済み。0.8.1 では広げない。
3. **提供者条件** — 生成モデル提供者の利用条件本文はこのリポジトリで読んでいない。
   読む必要があると owner が判断したときに別 Issue にする。
4. **`jumping`（row 4）** — 未出荷。反応として足すなら「操作できる」方向の
   追加になり §5.6 と衝突するので、実装ではなく owner 判断が先。

## 8. 関連

- owner 指示（配置の改訂）: `.tmp/supervisor/pet/OWNER-2026-11-01-2.md`
- 実機の描画記録: [`docs/verification/visual/pet-companion/overlay-verification.md`](../verification/visual/pet-companion/overlay-verification.md)
- 権利記録: [`docs/verification/legal/pet-melty-rights-review.md`](../verification/legal/pet-melty-rights-review.md)
- 権利契約: `src/legal/contract.ts`（Issue #497）
- reduced motion 契約: `src/editorial/reduced-motion.ts`（Issue #403）
- Home の設計方向: [`src/home/brief.md`](../../src/home/brief.md)
- 権利 gate の監査範囲: Issue #780
