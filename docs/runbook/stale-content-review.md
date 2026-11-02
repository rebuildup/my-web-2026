# 公開 copy の review date 運用 (Issue #437)

> 「今」を指す公開文言に **owner の review date** を持たせ、window を越えた
> 文面を **review target** として列挙する gate の運用手順。
> 契約の本文は [`../domain/content-review.md`](../domain/content-review.md)、
> owner の記録の正本は
> [`../../quality/stale-content-review.json`](../../quality/stale-content-review.json)、
> 検査は
> [`../../scripts/check-stale-content-review.mjs`](../../scripts/check-stale-content-review.mjs)。
> Cross-linked from
> [`../../quality/profile.yaml`](../../quality/profile.yaml#stale_content_review)、
> [`../architecture.md`](../architecture.md)、
> [`../development.md`](../development.md)。

## 1. 何が問題か

公開文言の中に「今」を指すものがある。

- 「現在、narrative subset に該当する公開作品はありません。」
- 「現在 re-verified されている contact channel はありません。」
- 「各 binding と外部境界の最新到達性。」

これらは **時間とともに古びる**。古びた文が **誤り** なのか **ただ古いだけ**
なのかを、機械は判定できない。判定できるのはowner だけである。

しかしリポジトリには、**その文を誰が何日に最後に読んだか** を
記録する場所がなかった。そのため:

- 古びた文が **読まれないまま** publish され続ける
- 書き換えのたびに **「今日読んだ」ことになる**（記録が無いまま
  放置される）
- 文の **真偽** と **読了状況** が混同される（機械が「古い = 誤り」と
  主張するように見える）

本 runbook と gate はその混同を閉じる。**gate は「読んでいない」を
「誤っている」にしない。**

## 2. 3 つのファイルの責務

| file | 責務 | 変更の合否 |
| --- | --- | --- |
| `quality/copy-editorial-surfaces.json` | **対象**。どのファイルが visitor-facing copy か | 既存の宣言（#506 が所有）。本 gate は **読むだけ** |
| `quality/stale-content-review.json` | **判断記録**。owner が各文を最後に読んだ日 | owner が書く。gate は読むだけ |
| `scripts/check-stale-content-review.mjs` | **検査**。時間語を含む文面を抜き、記録と突き合わせる | `validate:fast` の一部 |

「公開 copy」の定義は **1 つだけ** ある。編集レビュー承認 gate と同じ surface
宣言を読むので、2 つの copy gate が別の「公開 copy」を二重に定義することはない。

## 3. 判定の語彙

| status | 意味 | gate の exit |
| --- | --- | --- |
| `current` | 記録があり、review date が window の内側 | 0 |
| `stale` | 記録はあるが review date が window の外側（**review pending**） | 1 |
| `unrecorded` | その文面に該当する記録が無い（**review pending**）。文を書き換えると、古い記録が失効してここに戻ってくる | 1 |
| `not-scanned` | その locale が opt-in されていないので見ていない | 0（queue に入らない） |

`stale` と `unrecorded` はどちらも **review pending** であり、owner の読み直し
を待つ。**どちらも「誤り」ではない。** レポートはその 2 つを混ぜず、
`review pending` という言葉で書く。

## 4. 実行手順

### 4.1 日常（ contributor / agent ）

```bash
pnpm run copy:stale:check
```

- exit 0 なら、レビュー待ちはない。
- exit 1 なら、review queue に並んでいる文を owner に提示する。**その PR で
  文を書き換えても、review date の更新は owner の仕事**（#506 と同じ posture）。
- exit 2 なら **判断できなかった**。registry が読めない / record が壊れて
  いる / 日付が parse できない / review date が未来。**pass にはしない。**

### 4.2 owner（判断する人）

1. review queue の文を **1 件ずつ** 読み、implementation / data file と
   突き合わせる。
2. そのままよいなら、`reviewedAt` を今日に、`note` に **何を確認したか**
   （file と行）を書いて `quality/stale-content-review.json` を更新する。
3. 表現を変えたいなら、**#506 の編集レビュー承認** を通す。本 gate は
   書き換えを提案しないし、公開もしない。
4. **owner 確認を台帳に固定する (Issue #720)。** 確認の根拠を issue comment
   として残し、record の `provenance` を `kind: "owner-review"` /
   `reference: "<その URL>"` / `ownerConfirmation: "confirmed"` に更新する。
   **「gate が緑だった」ことは owner 確認の根拠にならない。**

### 4.3 記録を repository に残す

`quality/stale-content-review.json` の `expressions[]` に 1 件追加する。

```json
{
	"id": "contact-channels-heading-title",
	"path": "src/contact/page.tsx",
	"expression": "現在利用可能な channel",
	"locale": "ja",
	"dimension": "prose",
	"reviewedAt": "2026-11-04",
	"reviewedBy": "owner",
	"provenance": {
		"kind": "owner-review",
		"reference": "<owner の review / issue comment の URL>",
		"recordedBy": "<owner の識別子>",
		"ownerConfirmation": "confirmed"
	},
	"note": "src/contact/public.ts:52 の getVisibleChannels() が返す一覧の題字。30 日 gate は src/contact/schema.ts:67。"
}
```

`expression` は **表示文面の byte-exact** な文字列。gate はそれで照合する。
**文を書き換えると、この記録は失効する**（次の実行で `unrecorded` になる）。

`provenance` は **その review date が owner のものである**ことを示す欄である
(Issue #720)。owner 自身が読まずに agent が記入した record には
`kind: "agent-recorded"` / `ownerConfirmation: "unconfirmed"` を書き、gate は
それを **owner 確認待ち** として報告する。

**`reviewedBy` は「その台帳行を書いた主体」である (Issue #754)。** owner の承認
ではない。owner 自身が読まずに agent が記入した行は `reviewedBy: "agent"` であり、
`reviewedBy: "owner"` にしてはならない（owner がその行を書いていないなら）。
**owner が確認したかどうかは `provenance` だけが述べる。** `reviewedBy` を
owner の名前に書き換えても、owner 確認の証拠にはならない。

### 4.4 再確認

```bash
pnpm run copy:stale:check
```

## 5. window の運用

### 5.1 window を変える

`quality/stale-content-review.json` の `freshnessWindowDays`（現在 90 日）。
これは **読む間隔** であり、**真である期間** ではない。

### 5.2 locale を opt-in する

`locales` に locale を足す。検出器の token 表
（`LOCALE_TOKENS`）に、その locale の語が 無ければ足す。足さないまま
opt-in すると、その locale の文面は検出されない（`not-scanned` のまま）。

### 5.3 対象外の文面

`excludedPaths`（glob と reason）と `excludedExpressions`（path・文面・reason）。
**理由の無い除外は書かない。** 除外は registry の中なので、レビュー時に
読める。

## 6. 対象外（宣言済みの対象外）

| 対象 | 理由 |
| --- | --- |
| 内部文書・skills・tests・Storybook | visitor-facing copy ではない（surface 宣言の外） |
| `src/editorial/error-states/**` | runtime message。障害時に機械が出す文で、公開内容についての主張ではない |
| `src/home/reactions/widget.tsx` のエラー文 | 同上 |
| 時間幅だけがある文（「30 日以内」） | detector は「今を指す語」を探すのであって、時間帯を探すのではない |
| prose / typography の評価 | それぞれ owner と font stack の仕事。gate は 2 つを分けて報告するだけ |
| **公開からの除去** | **owner の決定**。gate は review target を作るだけで、除去しない |

## 7. 既知の限界（隠さない）

- **検出は token ベース**である。構文解析はしない。「今日」「現在」「最新」
  「今」「現時点」と、それらの結合-word を対象にする。**「今」を含まない
  間接的な時間表現**（相対日付の数字、「～」で結ばれた期間）は検出しない。
- **`現状` / `応答` / `実在` は検出しない**（語の一部に一致しない）。
  `実現在` は「実在」の意味なので検出しない。`最新鋭` / `今月` / `今年` /
  `至今` などの固定結合も検出しない。
- **`最新号` は検出する**。「最新号」は「いま最新の号」を指すので、`現在`
  と同じように古びる。文の誤りではなく版の古びかたである。検出規則の
  判定はここで固定しており、corpus 任せにしない。
- **segment は行単位**である（編集レビュー承認 gate と同じ抽出）。行を
  跨ぐ 1 文は複数 segment になる。registry にも複数件が要る。
- **registry に無い文面の英語は `not-scanned`**。検出器は token を持つ
  が、抽出は日本語の segment だけを見るため、英語は文字列リテラルから
  採る。**生の JSX テキスト（英語）は採れない。**
- **reviewer の同一性を検証しない。** `reviewedBy` は記録された文字列で
  あり、その人物が owner であることの証明ではない。実際の権限は PR review
  にある（AGENTS.md §6）。**Issue #754 以降、`reviewedBy` は「台帳の行を
  書いた主体」を名指しする欄である** — owner が承認したという意味ではない。
  自動化された側が書いた行は `agent` であり、owner 確認の有無は `provenance`
  だけが述べる。
- **review date は「記録された主張」である (Issue #720)。** registry の
  `reviewedAt` は「owner がこの文を読んだ日」という **主張** であり、owner が
  読んだことそのものではない。gate は record の `provenance` を読む:
  `kind: "owner-review"` + traceable な `reference` +
  `ownerConfirmation: "confirmed"` だけが **owner 確認済み** であり、
  自動化された側が書いた record は **owner 確認待ち** として報告される
  （`reviewedBy: "owner"` という文字列は registry 自身の主張にすぎない）。
  gate は **日付を書き換えない** — 分類を変えるだけである。
- **reference の「指している先」を検証しない (Issue #720)。** gate は
  reference の **形** だけを見る。GitHub 上のコメントは gate が読まない
  （offline / status-only が gate の契約である）。**reference は人間行動に
  ついての主張**であり、repository はその主張を記録するが独立に証明はしない。
  台帳全体の監査は
  [`docs/verification/governance/approval-provenance.md`](../verification/governance/approval-provenance.md)
  にある。
- **window は「読む間隔」であって「真である期間」ではない。** gate が緑でも
  文が誤っていることはある。gate はそれを **検出しない**。

## 8. 検証と再現

```bash
# gate 単体
pnpm run copy:stale:check

# HTML レポート
node scripts/check-stale-content-review.mjs --format=html \
  --out=.tmp/stale-content-review.html

# fixture による 4 状態の検証
node --test scripts/check-stale-content-review.test.mjs

# 検証画像（WebP）を再生成
pnpm run verify:stale-copy-review-screenshot
```

fixture は `test/fixtures/content/stale-review/` に 1 つ。4 状態
（`current` / `stale` / `unrecorded` / `not-scanned`）、typography dimension、
そして「文を書き換えると記録が失効する」ことを 1 つの小さな tree で
示す。

検証画像:
[`docs/verification/content/stale-copy-review.webp`](../verification/content/stale-copy-review.webp)
（検証記録は
[`docs/verification/content/stale-copy-review.md`](../verification/content/stale-copy-review.md)）。

## 9. 関連 Issue との重複回避

- **#506** (`copy:approval:check`): PR の差分に対する owner の承認。本 gate は
  差分ではなく **リポジトリの状態**（更新日の管理）を見る。
- **#428** (`copy:i18n:check`): locale 契約。
- **#433 / #432**: 文字そのものの policy。
- **#492** (`routes:quality:check`): route roster と gate coverage の ledger。
