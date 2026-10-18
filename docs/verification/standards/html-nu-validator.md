# HTML standards ゲート（Nu Validator 互換サブセット）

Issue #412 / gate: `pnpm run html:standards:check` / 宣言:
`quality/html-standards.json` / engine: `scripts/html-standards-contract.mjs`

## なぜ必要か

SSR が返す HTML には、これまで「機械的に検証されるもの」が存在しなかった。
ブラウザは回復力が高く、閉じていないタグ・重複した `id`・壊れた
`aria-labelledby` をすべて黙って修復するため、ページは表示されたまま
スクリーンリーダー向け名前だけ壊れた状態で本番に出る。

公開されている選択肢は 2 つある。

1. `validator.nu` に document を POST する — **採用しない**。/`admin/*`
   の描画済み document と personal copy を含めて third-party host に送信することになり、
   本リポジトリが「route の HTML を外部へ送る」ことを常態化することになる。
2. ローカルの engine — **本 gate がこれ**。依存追加ゼロ・ネットワークゼロ・
   CI で決定的に再現できる。

対象にしたのは Issue が名指した 3 分類。

| 分類 | rule |
| --- | --- |
| 不正な markup | `invalid-nesting` / `misnested-tag` / `stray-end-tag` / `unclosed-element` / `missing-doctype` / `missing-element` |
| 重複 ID | `duplicate-id` / `bad-id` |
| attribute の誤り | `unknown-attribute` / `duplicate-attribute` / `bad-value` / `missing-attribute` / `bad-idref` |

## 1 engine、3 front-end

`scripts/html-standards-contract.mjs` が tokenizer・tree builder・rule engine を
1 つ持ち、3 つの入口が同じ engine を呼ぶ。片側だけ通る rule は存在しえない。

| front-end | 入力 | どこで走るか |
| --- | --- | --- |
| `test/integration/html-standards.test.ts` | 実 Worker の SSR document（`SELF.fetch`） | `pnpm run test` の中（= CI `validate`） |
| `scripts/check-html-standards.mjs`（offline） | commit 済み fixture + route roster + rule ledger | `validate:fast` |
| `scripts/check-html-standards.mjs --live <baseUrl>` | dev server / `vite preview` / 任意の origin の SSR document | 手動（report 用） |

engine は Node / workerd のどちらでも動くよう dependency ゼロで書いてある
（`node:fs` などの import を持たない）。

## rule の severity と根拠は manifest が所有する

`quality/html-standards.json#rules` が severity と reason を所有し、
engine は「その rule が存在するか」だけを所有する。両者の list は
**双方向**に一致していなければ fail する。

- manifest が engine にない rule を宣言 → fail
- engine が出しうる rule を manifest が書いていない → fail
- severity が `error` / `warning` 以外、または reason が placeholder → fail

現状 `heading-level-skip` と `obsolete-doctype` だけが warning で、
残りは error です。

## route roster — 未実装 route を無言の合格にしない

`quality/html-standards.json#routes` は `src/routes/**`（`createFileRoute` を
呼ぶファイル）と `src/routeTree.gen.ts` から導出した全 route id を
宣言します。両方向とも不一致で fail:

- `inventory.unlisted` — 公開されている route が manifest に無い
- `inventory.missing` — manifest に 있는 route が存在しない
- `route.unobserved` — `mode: render` と宣言された route に observation が無い
- `route.request-failed` / `route.not-rendered` / `route.not-html` —
  取得失敗・非 2xx・`text/html` 以外。いずれも **skip ではなく fail**

`mode: excluded` は理由つきの宣言であり、理由なしは manifest を load した
時点で落ちます。admin の auth-gated route は全てここに入ります
（匿名で document が返らないため。admin の描画 document は
`/admin/login` で検証しています）。

代表 route の選び方と根拠は manifest の `why` に書いてあります。
`/design-system` はSVG と definition list が最も多い surface なので、
engine の誤検知（false positive）に対する canary として意図的に入れています。

## fixture — fail になる場合

`validate:fast` が毎回行うこと:

- `test/fixtures/html-standards/invalid-page.html` は **必ず error を出す**
- `test/fixtures/html-standards/valid-page.html` は **必ず 0 error**
- `fixtures.expect` に挙げた rule が invalid fixture で **全部発火する**
  （発火しなくなった rule = 検出漏れ）
- `fixtures.forbidden` に挙げた rule が invalid fixture で **発火しない**
  （engine の誤検知）

つまり「invalid fixture が通るよう書き換えた」時点で gate は落ちます。

## 実行方法

```sh
# offline gate（validate:fast に入る。server も network も不要）
pnpm run html:standards:check

# fixture suite
node --test scripts/check-html-standards.test.mjs

# SSR half（実 Worker / workerd）
pnpm exec vitest run test/integration/html-standards.test.ts

# 実サーバーに対して同じ engine（dev server / vite preview / 任意の origin）
pnpm run dev                       # terminal 1
node scripts/check-html-standards.mjs --live http://127.0.0.1:5173

# report + スクリーンショット再生成
pnpm run verify:html-nu-validator-screenshot
```

期待結果: offline / live / vitest はいずれも **exit 0**。exit 1 は finding、
exit 2 は manifest が読めない/使えない場合です。

## スクリーンショット

`docs/verification/standards/html-nu-validator.webp`（Issue が要求する
`html-nu-validator.png` のstem をそのまま使い、拡張子だけ `.webp` に
置き換えています。PNG を commit しない規約のため）。

- 生成コマンド: `pnpm run verify:html-nu-validator-screenshot`
- 含まれるもの: offline gate の verdict、valid / invalid fixture の実結果、
  invalid fixture の Nu message リスト、route roster、rule ledger、再現コマンド
- 環境: 完全オフライン（network なし / secret なし / D1・R2 なし）、
  Playwright chromium + sharp（devDependency のみ、Worker には入らない）

## 既知の制約

- **HTML5 の部分集合**。rule table がモデル化した element のみが対象で、
  表に無い element 名は「finding にならない」。custom element を
  誤検知しない代わりに、未知の element の属性も検査しません。
- **foreign content**（`<svg>` / `<math>`）は属性・nesting を検査しません。
  SVG の属性名は大文字小文字が意味を持つ（`viewBox`）ため、naive に検査すると
  誤検知しか出ません。`id` の重複検査だけは foreign をまたいで効きます。
- **外部 schema / CSS / ARIA role 辞書は見ません**。参照グラフ
  （`aria-labelledby` / `aria-describedby` / `label[for]` / `td[headers]` が
  実在する `id` を指しているか）だけが対象で、role と token の妥当性は
  対象外です。axe-core 相当の a11y gate は別系統の作業です。
- **waiver ledger**（`quality/html-standards.json#waivers`）は現在空です。
  entry を足すのは owner review 側の判断で、**何も suppress しない waiver は
  fail** するので、放置された waiver が緑を維持することはありません。
- live mode は local/dev 相当の origin を想定しており、production origin への
  実行は行っていません（canonical origin への送信は本 gate の外）。
