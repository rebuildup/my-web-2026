# 公開日本語 copy の編集レビュー承認 runbook (Issue #506)

> 訪問者が読む日本語の文言が PR で変わったとき、その変更に **owner の判断** が
> 記録されていることを要求する gate の運用手順。
> 正本は
> [`quality/copy-editorial-surfaces.json`](../../quality/copy-editorial-surfaces.json)、
> [`quality/copy-editorial-approvals.json`](../../quality/copy-editorial-approvals.json)、
> [`scripts/check-copy-editorial-approval.mjs`](../../scripts/check-copy-editorial-approval.mjs)。
> Cross-linked from
> [`quality/profile.yaml`](../../quality/profile.yaml#copy_editorial_approval)、
> [`copy/README.md`](../../copy/README.md)、
> [`docs/architecture.md`](../architecture.md)、
> [`docs/development.md`](../development.md)。

## 1. 何が問題か

公開日本語の文言は、**書く** ことが許された作業ではなく、**決める** ことが
許された対象である。語調・敬称・否定・権限の含意は機械では判定できず、
 Issue #428 が明言した通り「`prose: "verified"` は原文と突き合わせた人が記録する
主張であり、機械の判定結果ではない」。

だがリポジトリには、**その主張が PR 単位で存在するか** を見る場所がなかった。
そのため:

- 公開文言を書き換えた PR が、レビューなしのまま publish される
- 編集補助ツール (yomiyasu および同種の道具) の **出力** が、そのまま
  「レビュー済み」に読まれる
- 原文と何を比べて、どう採否したかが **どこにも残らない**

という状態だった。本 runbook と gate はその 3 つを閉じる。

**gate がしないこと**: 日本語を採点しない。文脈適合・敬称・語順を判定しない。
gate が主張するのは **証拠** だけである — 「この変更には owner の判断が
記録されている / 記録されていない」。

## 2. 3 つのファイルの責務

| file | 責務 | 変更の 合否 |
| --- | --- | --- |
| `quality/copy-editorial-surfaces.json` | **対象**。どのファイルが「訪問者が読む日本語 copy」か | owner の copy decision。拡張は owner が行う |
| `quality/copy-editorial-approvals.json` | **判断記録**。owner が何を採否したか | owner が書く。gate は読むだけ |
| `scripts/check-copy-editorial-approval.mjs` | **検査**。差分から変更された日本語を抜き、記録と突き合わせる | CI の `validate` ジョブで実行 |

3 つは **別々** に drift しうる。だから gate は 3 つをすべて読み、
「対象の public copy が 1 つも無い」「判断記録が無い」「記録が別の文面を指す」
をそれぞれ別の状態として報告する。

## 3. 判定の語彙

### 3.1 4 つの verdict

| verdict | 意味 | merge を止めるか |
| --- | --- | --- |
| `pass` | 変更された公開日本語に、_complete な owner 承認記録がある | 止めない |
| `fail` | レビューが記録されていて **否定** された、または記録が変更集合と矛盾する | 止める |
| `not run` (**NEEDS REVIEW**) | レビューが **記録されていない**。PR が誰も取っていない判断を要求している | 止める |
| `not applicable` | 公開日本語 copy が 1 つも変わっていない | 止めない |

`fail` と `not run` はどちらも merge を止めるが、**別の文**である。
`fail` は「調べた結果、出し直しが必要」、`not run` は「まだ誰も見ていない」。
レポートはこの 2 つを混ぜない。

### 3.2 3 つの review dimension

| dimension | 中身 | 記録する場所 |
| --- | --- | --- |
| `proposal` | 編集補助 (yomiyasu と同種) を変更文面に対して実行し、その提案を**採否した** | `records[].proposal` |
| `semantic` | 原文と変更後の文面を **意味として** 突き合わせた | `records[].comparisons[]` |
| `approval` | owner が **採否** した (approved / rejected) | `records[].decision` / `reviewer` / `reviewedAt` |
| `approval` の **前提** | その判断が **owner のものである**ことを裏付ける traceable な artefact | `records[].provenance` (Issue #720) |

**編集補助の出力は evidence であり、approval ではない。** `proposal` だけが整った
record でも `approval` が無ければ verdict は `not run` のまま。
これが Issue の「Skill や AI の実行結果だけで自動合格にしない」の実装である。

**Issue #720 以降、`approval` は provenance を要求する。** 「approved」と書かれた
record は **owner の承認の証拠ではない**。owner がその判断を行ったことを述べる
**traceable な artefact**（GitHub の review / issue comment）があるときだけ
owner 承認として数える。

### 3.3 3 つの dimension が `pass` になる条件

| dimension | pass の条件 |
| --- | --- |
| `proposal` | `ran: true` かつ `summary` と `disposition` が空でない |
| `semantic` | 変更された **全 segment** に `verdict` (equivalent / intentional) と `note` を持つ比較がある |
| `approval` | `decision: "approved"` かつ `reviewer` と `reviewedAt` があり、**かつ** `provenance` が owner 承認として成立する |

`decision: "rejected"` は `approval` dimension が `fail` になる。
`fingerprint` が一致しない record は **別文面の承認** なので `fail` (stale) になる。

### 3.4 provenance — 「approved」と書かれた record の owner-ness (Issue #720)

`approval` dimension が pass になるには、record が **provenance** を持つ必要がある。

```jsonc
"provenance": {
  "kind": "owner-review" | "agent-recorded" | "unverified",
  "reference": "<GitHub の review / issue comment の URL, または null>",
  "recordedBy": "<この record を書いた側: 'agent' | 識別子>",
  "ownerConfirmation": "confirmed" | "unconfirmed"
}
```

| 状態 | gate の扱い | rule id |
| --- | --- | --- |
| `kind: "owner-review"` + `reference` あり + `ownerConfirmation: "confirmed"` | **owner 承認**。`approval` = pass | — |
| `kind: "agent-recorded"` / `ownerConfirmation: "unconfirmed"` | **owner 確認待ち**。`approval` = not run、verdict = NEEDS REVIEW | `approval-owner-confirmation-missing` |
| `provenance` が無い / 壊れている | **拒否**。`approval` = not run、verdict = NEEDS REVIEW | `approval-provenance-missing` |
| `kind: "owner-review"` だが `reference` が無い | owner 承認として数えない | `approval-owner-confirmation-missing` |

**gate が数えないもの**: 「record が存在すること」「gate が PASS であること」を
述べるだけの artefact。「owner が record を確認・訂正する前提で運用する」といった
**代理書き込みの告白**も、owner 判断の artefact ではない。

**gate が報告するもの**: 台帳全体を **owner 確認済み** と **owner 確認待ち** に
分けて数え、copy gate の出力には

```
approval ledger: 6 record(s) — owner-confirmed 0, awaiting owner confirmation 6
change sets waiting for an owner decision: 6
```

と出る。**green であることと「owner 承認がある」ことは別の主張**である。

**推敲案が 0 件でも `ran: true` として記録する。** `ran` は「工具を実行したか」の
記録であり、提案の多さではない。工具を **実行しなかった** 場合は `not run` のまま
止まる（それが review 未確認の正しい状態である）。

### 3.5 技術的 CI と owner レビューの分離（#761）

既定の `pnpm run copy:approval:check` は厳密判定を維持する。PR の必須 CI では
`pnpm run copy:approval:check -- --allow-unreviewed` を実行する。

| verdict | 通常 CLI | PR 必須 CI | 意味 |
| --- | --- | --- | --- |
| `pass` / `not applicable` | exit 0 | exit 0 | 変更の承認記録あり／対象変更なし |
| `not run` | exit 1 | **警告 + exit 0** | owner 証跡なし。**承認済みとは記録しない** |
| `fail` | exit 1 | **exit 1** | 明示的な拒否・指紋不一致などはブロック |
| 差分不明・不正入力 | exit 2 | **exit 2** | 不明な差分を黙って通さない |

公開コピーの差分そのものと数値・否定・権限の変化は、独立した
`Japanese copy review targets` レポートで引き続き可視化する。
本モードは編集判断を AI に偽装するものではない。技術的な release CI
（統合検証・依存監査・Playwright E2E）が owner コメントの欠如によって
一切走らなくなる障害を解消するための CI 配置である。人間が確認していない
場合は `agent-recorded / unconfirmed` のまま保持する。

## 4. 実行手順

### 4.1 PR 作者（変更者）

```bash
# 1. 変更集合を見る（base は PR の base ブランチ）
pnpm run copy:approval:check -- --base=release-0-7-0

# 2. verdict が `not applicable` なら、公開日本語 copy の変更はない。
#    ここで終わる。
#
# 3. verdict が `not run` なら、表示される changed segment を編集補助に掛ける。
#    （yomiyasu および同種の道具は offline で提案を生成するための道具であり、
#      採用・不採用の判断は人間が行う。）
#
# 4. 承認記録に書く fingerprint を出力する
pnpm run copy:approval:check -- --base=release-0-7-0 --print-fingerprint
```

### 4.2 owner（判断する人）

1. 4.1 の changed segment を **原文と並べて** 読む。
2. 編集補助の提案があれば、採否を決める（採否の理由を記録に残す）。
3. 原文と変更後の意味差を判断する。意味が同じなら `equivalent`、
   意図的に変えたなら `intentional` とし、その理由を一文で残す。
4. `approved` / `rejected` を決める。

### 4.3 記録を repository に残す

`quality/copy-editorial-approvals.json` の `records[]` に 1 件追加する。

```json
{
	"id": "pr-512",
	"pr": 512,
	"base": "release-0-7-0",
	"reviewer": "<owner の識別子>",
	"reviewedAt": "2026-10-20",
	"decision": "approved",
	"provenance": {
		"kind": "owner-review",
		"reference": "<owner の review / issue comment の URL>",
		"recordedBy": "<owner の識別子>",
		"ownerConfirmation": "confirmed"
	},
	"fingerprint": "sha256:<4.1-4 で出力された値>",
	"proposal": {
		"tool": "yomiyasu",
		"ran": true,
		"summary": "推敲案 1 件: 「構築しています」を「移行を進めています」へ。",
		"disposition": "採用。移行中という実際の状態と一致するため。"
	},
	"comparisons": [
		{
			"path": "src/home/hero.tsx",
			"before": "…変更前の文面…",
			"after": "…変更後の文面…",
			"verdict": "intentional",
			"note": "構築中という主張を、移行中という実際の状態へ言い換え。否定・許可の意味は変わらない。"
		}
	]
}
```

`comparisons[]` は **変更された segment 1 つ 1 つ** に対応する。1 つでも欠けると
`semantic` dimension は `not run` になる。

`provenance` は **その判断が owner のものである**ことを示す欄である
(Issue #720)。`reference` には **owner がその判断を述べた review / issue comment
の URL** を書く。owner 自身が読まずに agent が書いた record には
`kind: "agent-recorded"` / `ownerConfirmation: "unconfirmed"` を書き、
gate はそれを **owner 確認待ち** として報告する（`approval` dimension が
`not run` になり、verdict は NEEDS REVIEW になる）。

**「gate が PASS だった」ことは owner 承認の根拠にならない。** gate は
「その record が owner の artefact を指しているか」しか見ていない。

### 4.4 再確認

```bash
pnpm run copy:approval:check -- --base=release-0-7-0   # verdict: PASS
```

### 4.5 agent が書いた record を owner 確認済みにする (Issue #720)

`provenance.kind` が `agent-recorded` の record は、**owner 承認ではない**。
owner 確認済みにする手順は:

1. 該当 PR の変更された公開日本語を **原文と並べて** 読む。
2. その判断を **PR review または issue comment** として残す（traceable な
   artefact。gate が `reference` に指すのはこの URL）。
3. 該当 record の `provenance` を `kind: "owner-review"` /
   `reference: "<その URL>"` / `recordedBy: "<owner の識別子>"` /
   `ownerConfirmation: "confirmed"` に更新する。

**fingerprint は変えない。** 変更集合が変わっていない限り fingerprint は
変わらない。`decision` は `approved` のままでよい（既に判断が記録されて
いるなら）。**「gate が PASS だったから」で `ownerConfirmation` を
`confirmed` にしてはならない** — それは owner 自身の artefact でなければならない
ならない。

## 5. fingerprint とは

`fingerprint` は **変更後の文面** から計算した sha256 である
(`path` / `kind` / `after` を sort して連結)。承認は **文面** に結び付いており、
別の文面へ流用できない。

gate が diff するのは **PR 自身の変更集合** である。base ref と head を
そのまま二点 diff (`git diff base head`) すると、fork 後に動いた base
ブランチが公開した文面まで「この PR が変更した文面」として現れ、報告も
fingerprint も環境によって変わる。そのため gate は次の順で diff base を決める。

1. `git merge-base <base> <head>` — 履歴が揃っているローカルではこれ。
2. 見つからなければ、head が **merge commit（parent 2 つ以上）** のときだけ
   その first parent。CI の `refs/pull/<n>/merge` はこれに当たる。
3. どちらも無ければ **exit 2**。判断できない変更集合を pass にはしない
   （単一 parent の head を親と diff すると最後の commit だけを審査して
   しまうため、これは採らない）。

したがって base ブランチが動いても、この PR が公開する文面が同じなら
fingerprint は変わらない。

`fingerprint` が食い違う record 只有一个が found されたとき、gate は
`stale-approval` として **fail** する。「前の PR で承認したから」という
流用は通らない。

## 6. 対象外（宣言済みの対象外）

| 対象 | 理由 |
| --- | --- |
| `docs/**` / `skills/**` / `AGENTS.md` / `README.md` の日本語 | contributor 向きの文書であり、visitor-facing copy ではない |
| `scripts/**` / `test/**` の日本語 | 開発用 artefact の日本語であり、公開文面ではない |
| `src/admin/**` / `src/routes/admin.*` | 認証の背後にある owner 専用 surface |
| `*.stories.tsx` / `**/fixtures/**` / `src/routes/design-system/**` | サンプルとデモであり publish される copy ではない |
| 編集補助ツールの **採用判断** 自体 | gate は採点しない。gate が問うのは「判断が記録されたか」だけ |

**この対象外リストは owner の copy decision である。** 内部文書も対象に入れたい
場合は `quality/copy-editorial-surfaces.json` の glob を広げ、記録運用を変える
(owner decision であり agent が行わない)。

## 7. 既知の限界（隠さない）

- **抽出はテキスト走査である。** 文字列リテラルと JSX の生テキストから日本語の
  セグメントを抜き出す。構文解析はしない。コメント行は対象外。英文中の
  アポストロフィ等同型で literal の切り取りが乱れる場合は **取りこぼし** 側に
  倒れる (誤検出より安全)。
- **1 行複数リテラル** は、出現順に removed 側と added 側を位置対応で結ぶ。
  1 文の書き換えでは正しいが、複数 segment の一括差し替えでは対応が
  ずれる可能性がある。ずれた場合も **segment 自体は列挙される** ので、
  記録すべき対象は失われない。
- **gate は reviewer の同一性を検証しない。** `reviewer` は記録された文字列で
  あり、その人物が owner であることの証明ではない。**実際の権限は PR review に
  ある** — AGENTS.md §6 のとおり、release PR の merge は owner しか行わない。
- **gate は reference の「指している先」を検証しない (Issue #720)。** gate は
  reference の **形**（文字列として存在するか、review / comment らしい形か）
  だけを見る。**GitHub 上のそのコメントを gate は読まない**（offline /
  status-only が gate の契約である）。**reference は人間行動についての主張**で
  あり、repository はその主張を **記録する** が **独立に証明はしない**。
  したがって「owner 承認がある」と書かれることと「owner 承認がある」ことは
  別である。台帳全体の監査は
  [`docs/verification/governance/approval-provenance.md`](../verification/governance/approval-provenance.md)
  にある。
- **base ref の解決に既定値がない。** `--base` / `COPY_APPROVAL_BASE` /
  `GITHUB_BASE_REF` の順で解決し、どれも無ければ exit 2（入力エラー）である。
  誤った base に対する verdict を出さないためである。
- **1 PR = 1 承認** である。承認の fingerprint は **変更集合全体** に紐づく
  ので、承認後に別の文面を追加すると fingerprint が変わる。差分毕业后、
  追加分を含めて owner に再承認を仰ぐ。
- **shallow clone を前提にする。** CI は `actions/checkout` の depth-1 clone であり、
  base commit は含まれない。CI ステップは base ref を明示的に fetch する。
  depth-1 では merge base を計算できないため、その場合は PR の merge commit
  の first parent を使う。どちらも取れない checkout（単一 parent の head など）
  では gate は exit 2 で止まる — 履歴を fetch してから実行する。

## 8. 検証と再現

```bash
# gate 単体（base を明示する）
pnpm run copy:approval:check -- --base=release-0-7-0

# HTML レポート
node scripts/check-copy-editorial-approval.mjs --base=release-0-7-0 \
  --format=html --out=.tmp/copy-editorial-approval.html

# fixture による 4 状態の検証
node --test scripts/check-copy-editorial-approval.test.mjs

# 検証画像（WebP）を再生成
pnpm run verify:copy-editorial-approval-screenshot -- --base=origin/release-0-7-0
```

fixture は `test/fixtures/copy/editorial-approval/` に 6 件ある。

| fixture | verdict | 何を証明するか |
| --- | --- | --- |
| `approved.json` | `pass` | 完全な承認記録がある変更集合（provenance は owner-review + reference） |
| `needs-review.json` | `not run` | 記録が無い変更集合は pass にならない |
| `agent-recorded.json` | `not run` | agent が書いた記録（`ownerConfirmation: "unconfirmed"`）は owner 承認にならない (Issue #720) |
| `rejected.json` | `fail` | owner が拒否した変更集合 |
| `stale-approval.json` | `fail` | 別の文面への承認は流用できない |
| `not-applicable.json` | `not applicable` | 公開日本語が変わらない PR はレビュー不要 |

検証画像: [`docs/verification/copy/editorial-approval-gate.webp`](../verification/copy/editorial-approval-gate.webp)
（検証記録は
[`docs/verification/copy/editorial-approval-gate.md`](../verification/copy/editorial-approval-gate.md)）。

## 9. 関連 Issue との重複回避

- **#428** (`copy:i18n:check`): locale 契約 — どの capability がどの言語で
  公開されているか、未翻訳キー、fallback 連端、数値/否定/権限の保持。
  **機械で決められること** の gate。本 runbook の対象は **判断されたか** であり、
  #428 の `prose: "verified"` と同じ「人の主張」を PR 単位で記録する面である。
- **#433** (Unicode / URL slug policy) / **#432** (glyph fixture): 文字体系の
  policy。本 gate は文字の **出所**（誰が決めたか）を問うもので、文字そのものの
  policy ではない。
- **#492** (`routes:quality:check`): route roster と gate coverage の ledger。
  対象は route であり copy ではない。
- **#508** (`release:gate:check`): release が実行する検査の ledger。
  本 gate は **差分** を対象にするため release ではなく pull request の
  ゲートとして、CI の `validate` ジョブに置いてある（profile の
  `copy_editorial_approval` ブロック）。
