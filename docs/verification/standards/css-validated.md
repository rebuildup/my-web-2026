# CSS 構文・語彙ゲート（Panda 生成 CSS の静的検証）

> Issue #413 で導入した、出力 CSS を「parsable か」「名前が存在するか」
> 「値がそのプロパティの文法か」の 3 問いで検証する repository-owned gate。
> 機械可読な定義は [`quality/css-standards.json`](../../../quality/css-standards.json)、
> 実装は [`scripts/check-css-syntax.mjs`](../../../scripts/check-css-syntax.mjs)、
> fixture suite は [`scripts/check-css-syntax.test.mjs`](../../../scripts/check-css-syntax.test.mjs)。

## なぜ必要か

Panda がこのプロジェクトの CSS を生成し、**ツールチェーンのどこもその CSS を parse
したことがない**。`pnpm run build` は bundle が組めることを示すだけで、スタイルシートが
正しいことを示さない。以下はすべて**ブラウザが宣言を黙って捨てる**壊れ方で、
どの gate も緑を返す。

| 症状 | 実際の結果 |
| --- | --- |
| `width: 40rem` の `;` 欠落 | 以降の宣言ごと消える |
| `color: ;` | その宣言だけ消える |
| `colr: red` | その宣言だけ消える（未知 property） |
| `transl8te(4px)` | 値が無効になり宣言ごと消える |
| `position: fixedd` | 未知 keyword は parse 時に捨てられる |

W3C CSS validator はこの 3 問いに正確に答えるが、CI から呼ぶと gate が第三者
ネットワークサービスに依存する。よって本リポジトリは**同じ問いをオフラインで**答える:
CSS Syntax 準拠の tokenizer + parser、レビュー済み vocabulary、そして列挙 keyword の
閉集合。依存パッケージは追加していない（純 Node、`node_modules` の追加ゼロ）。

## 検証面（surface）

| surface | kind | 中身 |
| --- | --- | --- |
| `panda-generated` | `panda-cssgen` | `panda cssgen` が `.tmp/css-syntax/panda-generated.css` に出力する生成 CSS（preflight / tokens / recipes / utilities）。gate 自身が生成するため、artifact が消えても「検証対象が無い」とは読まない |
| `src-css` | `files` | `src/**/*.css` の手書きスタイルシート（`src/styles.css` の `@font-face` descriptor、`@layer` 順序、reduced-motion override） |

`coverage.root` は `src`。surface に属さないスタイルシートは `surface_uncovered` で
fail する（= 検証されない CSS が増えない）。生成物は `.tmp/`（AGENTS.md §9 の
gitignored 一時領域）にのみ書き出し、追跡ファイルを一切変更しない。

## 判定の 4 層

1. **構文** — `unclosed_block` / `stray_close_brace` / `missing_colon` /
   `missing_semicolon` / `empty_value` / `declaration_at_top_level` /
   `empty_selector` / `unclosed_rule` / `unterminated_comment` /
   `unterminated_string` / `bad_url` / `invalid_important` /
   `invalid_keyframe_selector`
2. **語彙** — `unknown_property` / `unknown_at_rule` / `unknown_function` /
   `invalid_enum_value` / `descriptor_outside_font_face` /
   `property_not_allowed_in_font_face`
3. **前フリ（at-rule prelude）** — `invalid_at_rule_prelude` /
   `nonempty_at_rule_prelude`（`@media min-width: 40rem` のような宣言書き @
   media、`@supports` に条件が無い、`@property` にカスタムプロパティ名が無い、
   `@font-face "Foo" { … }` など）
4. **無言の合格の防止** — `surface_empty` / `surface_uncovered` /
   `vocabulary_underfloor` / `allow_unused` / `vendor_prefix_unresolved`

## manifest の構造

```jsonc
{
  "schema_version": 1,
  "policy": { "name": "css-modules-standard", "min_declarations": 400 },
  "coverage": { "root": "src", "extensions": [".css"] },
  "surfaces": [
    { "id": "panda-generated", "kind": "panda-cssgen", "role": "…", "min_declarations": 400 },
    { "id": "src-css", "kind": "files", "root": "src", "extensions": [".css"], "min_declarations": 10 }
  ],
  "vocabulary": {
    "properties": { "https://www.w3.org/TR/css-box-4/": ["box-sizing", "…"] },
    "at_rules":   { "none": ["font-face"], "condition": ["supports"], "optional-list": ["media"] },
    "functions":  ["var", "calc", "…"],
    "enum_values": { "position": ["static", "relative", "absolute", "fixed", "sticky"] }
  },
  "allowlist": {
    "vendor_prefixes": [{ "id": "standard-vendor-prefix", "prefixes": ["-webkit-", …],
                          "require_known_unprefixed": true, "reason": "…", "basis": "…", "surfaces": […] }],
    "properties":  [{ "id": "…", "name": "-webkit-font-smoothing", "kind": "engine-specific",
                      "surfaces": ["panda-generated"], "reason": "…", "basis": "…" }],
    "functions": [],
    "at_rules": []
  }
}
```

- `vocabulary.properties` は **spec module URL → その module が定義する property**
  の表。名前を追加するのは「定義している spec module の行に 1 つ足す」操作であり、
  gate を緩める操作ではない。1 つの property が 2 module に出ると manifest load で失敗。
- `vocabulary.enum_values` の値が `*` のものは複数 keyword を許す
  （例: `color-scheme: light dark`）。重複した keyword は `invalid_enum_value`。
- `kind` は `engine-specific` / `spec-extension` / `vendor-prefix` のみ。
  `vendor-prefix` は名前単位では書けず（prefix 規則側で使う）manifest load で失敗する。

## vendor prefix と「仕様上許される拡張」

- **vendor prefix** は `allowlist.vendor_prefixes` の規則として宣言し、
  `require_known_unprefixed: true` が必須。prefix を取ったときの
  **prefix 無し側が vocabulary に存在する**ときだけ受理されるので、
  `-webkit-totally-made-up` が prefix 規則で潜り込めない。
  現在の使用例: `-webkit-text-size-adjust` / `-moz-tab-size` / `-webkit-appearance`。
- **engine 固有プロパティ**（標準名を持たない）は名前で免除し、`reason`（40 文字以上）
  と `basis` URL と `surfaces` スコープを必ず書く。現在の使用例は Panda preflight が
  生成する 3 つ（`-webkit-font-smoothing` / `-webkit-tap-highlight-color` /
  `-moz-osx-font-smoothing`）。
- どのエントリも**現在使われていること**が必要で、何も抑止していないエントリは
  `allow_unused` で fail する。陳腐化した免除は誤検知の免除ではなく、誰も再レビューしない穴。

## 実行方法

```bash
pnpm run css:check                                          # gate 本体（validate:fast に含まれる）
node scripts/check-css-syntax.mjs --json                    # 機械可読な結果
node scripts/check-css-syntax.mjs --artifact <path>.css     # ビルド済みスタイルシートを指定
node scripts/check-css-syntax.mjs --no-generate             # 直近の生成物を再検証する
node --test scripts/check-css-syntax.test.mjs               # fixture suite（50 cases）
pnpm run verify:css-screenshot                              # report HTML + WebP を再生成
```

期待結果（`src/**` の増加に合わせて宣言数は増える。下の行はこの report を最後に
再生成した時点の値）:

```
surfaces    2 declared · 2 stylesheet(s) · 676 declarations · 52 rules · 20 at-rules
vocabulary  279 properties from 32 spec module(s) · 16 at-rules · 78 functions · 26 enumerated value sets
allowlist   4 declared entries covering 7 occurrence(s)
exit 0      # `errors (n)` 行はエラーが 1 件以上あるときだけ出力される（0 件なら出ない）
```

`panda cssgen` が失敗した場合（codegen 未実行など）は exit 2 で失敗する。
「検証対象が読めなかった」を「検証対象が clean」にしないため。

## fixture — fail になる場合と通る場合

`scripts/check-css-syntax.test.mjs` は temp directory に合成 repository を作り、
**出荷と同じ manifest（`quality/css-standards.json`）** を使って各 rule を検証する。
fixture が「通る」ことは、fixture 用の緩い語彙を別途用意したのではなく
**本物の語彙がその記法を受理した**ことを意味する。

- 構文 12 ケース: 未閉 brace / 対応する brace の無い `}` / `:` 欠落 / `;` 欠落 /
  空値 / top level の宣言 / `!imporant` / 未閉コメント / 未閉文字列 / 未閉 `url(` /
  不正な keyframe selector / セレクタの無い `{`
- 語彙 10 ケース: 未知 property / 未知 at-rule / 未知 value function /
  文法外 keyword / `@font-face` 外の descriptor / `@font-face` 内の非 descriptor /
  宣言書き `@media` / prelude 付き `@font-face` / 条件無 `@supports` /
  名前無し `@property`
- 受理 12 ケース: vendor prefix（prefix 無し側が仕様定義済み）/ engine 固有の
  allowlist エントリ / カスタムプロパティ（`--blur: ;` の空値を含む）/
  CSS-wide keyword と `var()` / 複数 keyword / `@layer` の statement と block /
  `@keyframes` の from|to|%|カンマ区切り / Panda のエスケープ済みクラス名 /
  末尾 `;` 欠落 / CSS nesting / `@font-face` descriptor / コメント
- 無言の合格の防止 5 ケース: `surface_empty` / `surface_uncovered` /
  `vocabulary_underfloor` / `allow_unused` / `vendor_prefix_unresolved`
  （+ 他 surface にスコープされた免除が効かないこと）

PR 添付の report [`css-validated.webp`](./css-validated.webp) にも同じ checker の
実行結果として fixture A（意図的な誤り → exit 1）と fixture B（仕様どおりに書いた
同じ意図 → exit 0）が載っている。

## スクリーンショット

- 保存先: `docs/verification/standards/css-validated.webp`
  （Issue 本文の `css-validated.png` と同じ path を使い、拡張子のみ `.webp`。
  PNG はリポジトリを不必要に膨らませるため commit しない）
- 生成: `pnpm run verify:css-screenshot`
  （Playwright chromium で HTML report を capture → `sharp` で WebP 化。
  中間 PNG はメモリ上のみ）
- 同一条件の再現: 上記コマンド。gate が fail のときは report を生成せず終了し、
  fixture の期待（`A` が fail / `B` が pass）が崩れていればそれも終了する。

## 既知の制約

- **値の文法は閉集合の property だけ**を検証する。長さ・色・URL などの値は
  parse はするが、文法照合はしない（W3C validator の網羅には及ばない）。
- **セレクタ**は tokenize（括弧・角括弧・エスケープのバランス）までで、
  セレクタの妥当性・詳細度は検証しない。
- **生成物**: gate が検証するのは `panda cssgen` の出力であり、minify 済みの
  build artifact ではない。実ビルドのスタイルシートを検証するには
  `--artifact <path>` を指定する（`validate:integration` の `pnpm run build` 後に
  `dist/client/assets/*.css` を渡せる）。
- **有効だが後勝ちされる宣言**は指摘しない。本 gate は「妥当か」を答えるもので、
  「効いているか」ではない。
- Issue #414 の Baseline gate（互換性。「対象ブラウザで動くか」）とは別の問いを
  答える。互換性を決める責務は `compat:check` 側にあり、本 gate は Baseline
  snapshot を読まない。重複して互換性ゲートを作らないこと。
- allowlist の `basis` は仕様 URL であり、gate はその URL の到達性を検証しない
  （オフライン・hermetic を保つため）。宣言の根拠を追えることはレビュー上の規律。