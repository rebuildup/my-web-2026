# UI copy resource contract

> Status: **Observed contract** (Issue #428)
> Visibility: public (MIT)
> Audience: contributor, agent, owner

`resources.json` は visitor-facing copy の「どの capability がどの言語で公開されているか」を
宣言するリソース契約である。文言の実体は各 obligation のコンポーネントが持ち、このファイルは
**どの文言を翻訳 대상으로登録し、どの locale に出荷済みか**だけを宣言する。

検査は [`scripts/check-copy-i18n.mjs`](../scripts/check-copy-i18n.mjs) が担い、
`pnpm run copy:i18n:check`（`validate:fast` の一部）として CI で走る。

## この契約が持たないもの

- **locale 切り替えの runtime**。この ticket では「宣言と検査」のみを追加する。実際の
  locale 選択 UI / 配信経路は、最初に capability が 2 番目の locale へ opt-in する
  ticket で導入する。
- **copy の要約**。`keys[].source` は登録した文言の原文であり、要約ではない。
  `keys` は「翻訳対象として登録した文言」だけを置く。登録していない文言は
  「未翻訳キー」として報告される対象にならない。
- **(owner が公開していない) 事実**。文言の追加・書き換え・言語の追加は copy decision であり、
  agent が先取りして確定しない。

## スキーマ

| field | 意味 |
| --- | --- |
| `schemaVersion` | この gate が解釈する版（現在 `1`）。 |
| `knownLocales` | リポジトリが把握している locale 集合。feature が宣言しない locale は `info` になるだけで、失敗にはしない。 |
| `features[].id` | copy surface の識別子。owner と同じ粒度を使い、同一 owner に surface を足すときだけ	id を分ける。 |
| `features[].owner` | copy を所有する obligation（`src/<owner>` が実在することを確認する）。 |
| `features[].surface` | 対応する URL surface のメモ。検査対象ではない。 |
| `features[].sourceLocale` | 原文が書かれた locale。`locales` のうち `state: "source"` の locale と一致する必要がある。 |
| `features[].locales[<locale>]` | `state` は `source` / `translating` / `published`。`source` 以外は `fallback`（フォールバック先 locale）を持つ。 |
| `features[].keys[]` | 翻訳対象として登録したキー。`key`, `source`（原文）, `guarded`（権限・アクセス制御の意味を含むか）。 |
| `features[].messages[<locale>][<key>]` | 翻訳リソース。`text`, `status`（`draft` / `reviewed`）, `prose`（`verified` / `unverified`）。 |

原文は `keys[].source` にだけ置く。source locale のリソースは書かない（同じ文言を
2 箇所で保守する状態を gate が拒否する）。

## locale は opt-in

`locales` に列挙した locale だけが、その feature の公開言語である。すべての機能に
すべての言語を求めることはしない — 公開言語は capability ごとの copy decision であり、
[`docs/personal/owner.md`](../docs/personal/owner.md)「Working languages」が
「visitor-facing content の言語は capability ごとに決める」と宣言しているため、
gate は「宣言していない locale」を `info` として記録するだけに留める。

現在の `knownLocales` は `["ja"]` である。2 番目の言語は capability が opt-in を
決めた時点で追加する。追加前の言語を gate が要求することはない。

## fallback の意味

`translating` / `published` locale にリソースが無い場合、読む人は fallback 連鎖を辿って
source locale の原文に到達する。連鎖は feature の locale 宣言だけで決まり、必ず source
locale で終わる（循环・未宣言 locale・source 到達不能は `error`）。

**`draft` リソースは決して served されない。** 解決は必ず fallback 側へ進む
（`resolveMessage()`）。推敲途中の文言を repository に置いても、visitor には原文が見える。
`published` locale に `draft` が残っている状態は `draft-in-published-locale` として
`error` になる。`prose: "unverified"` も `published` locale では `error`
（未確定な推敲を公開しないための規則）。

## 機械で決められることと、決められないこと

| クラス | 内容 | 判定 |
| --- | --- | --- |
| `contract` / `coverage` / `fallback` / `publication` | 宣言の形状、未翻訳キー、未登録キー、fallback 連鎖の終端、draft の公開 | 契約のテキストだけで決まる。`error`。 |
| `preservation` | 数値・`{placeholder}`・否定・権限マーカーの保持 | マーカー照合による機械判定。`error`。heuristic。 |
| `typography` | 行頭/行末禁則、full-width の残留、句読点前の空白、連続スペース | locale の文字体系ごとの規則。`error`。 |
| `prose` | 語調・敬称・語順・文の長さ・文化適応 | **gate は判定しない。** `prose: "verified"` は人が原文と突き合わせて記録した主張であり、機械の判定結果ではない。 |
| `opt-in` | 把握しているが opt-in していない locale | 情報。失敗にしない。 |

否定・権限の検出は marker の集合による heuristic であり、誤検出より見落としを避ける側に
振っている。誤検出のコストは人の確認 1 回、誤検出漏れのコストは原文と反対の意味の出稿である。

Issue の参考先（yomiyasu を含む編集補助ツール）は **推敲の提案**として offline で使えるが、
その出力が品質を証明することはありません。`prose: "verified"` を書くのは、原文と突き合わせた
人が読んだときだけです。gate 自体に Python も機械翻訳サービスもネットワークも要りません
（Node >=22.18 のみ。`package.json#engines` の既存要件）。

## 実行と再現

```bash
# gate（既定で copy/resources.json を見る）
pnpm run copy:i18n:check

# 上のレポートをファイルへ
node scripts/check-copy-i18n.mjs --format=html --out=.tmp/copy-i18n.html

# 報告用の実行: repository 契約 + 未翻訳キーの fixture
node scripts/check-copy-i18n.mjs --include-fixture --format=html \
  --out=.tmp/missing-keys-report.html

# fixture 契約単体をゲート相当の判定で確認する（fixture は通常 gate しない）
node scripts/check-copy-i18n.mjs --contract=test/fixtures/i18n/missing-keys.contract.json --strict
```

fixture 契約 [`test/fixtures/i18n/missing-keys.contract.json`](../test/fixtures/i18n/missing-keys.contract.json)
は finding class ごとに違反を 1 つずつ植えた検証用データで、
`scripts/check-copy-i18n.test.mjs` がそれを走らせて各 class が今も発火することを確認する。
fixture の finding が gate を赤くすることはない（`--include-fixture` は非 gate）。

終了コード: `0` = gate 対象の run に error なし、`1` = error あり、`2` = 入力エラー。

検証画像: [`docs/verification/i18n/missing-keys-report.webp`](../docs/verification/i18n/missing-keys-report.webp)
（repository 契約の opt-in matrix と、fixture 契約の finding 一覧をまとめたレポート）。

## 2 番目の locale を opt-in する手順

1. `knownLocales` に locale を追加する。
2. feature の `locales` に `<locale>: { "state": "translating", "fallback": "<sourceLocale>" }`
   を追加する。`state: "published"` は全リソースが `reviewed` かつ `prose: "verified"` になるまで
   付けない。
3. 翻訳対象にする文言を `keys` に登録する（`source` は原文、`guarded` は権限文言なら true）。
4. 翻訳リソースを `messages` に置く。作業中は `status: "draft"`（served されない）。
5. `pnpm run copy:i18n:check` で未翻訳キー・数値/否定/権限の保持・禁則 violations を潰す。
6. 人が原文と突き合わせて確認した key だけ `status: "reviewed"`, `prose: "verified"` にする。
7. 全 key が揃ったら locale の `state` を `published` にする。

## 現在の未登録 scope

- `/admin/**` は意図的に登録していない。admin の文言は「招待 / Invitations」のように
  日英併記で書かれており、1 つの source locale として current code から導けない。
  登録は owner の copy decision。
- どの capability も 2 番目の locale に opt-in していないため、`keys` は空である。
  gate はこれを「未翻訳 0 件」と表示する。coverage を無いまま green にするのは
  「公開言語が 1 つ」という観測であり、10 言語対応 progress ではない。
- 実行時 locale 選択（visitor ごとに言語を選ぶ経路）は本 ticket の scope 外。