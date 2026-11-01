# 承認記録の provenance 監査 (Issue #720)

> `quality/copy-editorial-approvals.json` と `quality/stale-content-review.json` に
> 残る **全 27 記録** について、**誰が実際に決めたか** と **それを裏付ける
> traceable な owner artefact があるか** を判定し、分類し直した結果である。
> gate の正本は
> [`../../../scripts/check-copy-editorial-approval.mjs`](../../../scripts/check-copy-editorial-approval.mjs)
> と
> [`../../../scripts/check-stale-content-review.mjs`](../../../scripts/check-stale-content-review.mjs)、
> 運用手順は
> [`../../runbook/copy-editorial-approval.md`](../../runbook/copy-editorial-approval.md)
> と
> [`../../runbook/stale-content-review.md`](../../runbook/stale-content-review.md)。

## 1. 何が問題だったか

台帳は「approved」と書いていた。gate はその文字列を owner の判断として読み、
green の CI が「owner が確認済み」の証明のように読まれていた。

しかし **記録を書いたのは agent だった**。そしてそれは owner 自身のコメントが
明言している:

- Issue #662 (2026-10-22T08:13:39Z):
  「承認レコードは owner のマージ許可を根拠に agent が代理で書いています。
  `decision` を `rejected` に書き換えれば、以後のリリースマージは止まります。」
- Issue #621 (2026-10-22T09:35:20Z):
  「編集レビュー承認レコードは owner の記録項目です。agent がマージ権限を根拠に
  代理で書き込みました。」
- Issue #437 (2026-10-22T09:35:16Z):
  「registry の review date は owner が記入する項目です。agent がマージ権限を根拠に
  代理記入したレコードがあり、owner が内容を確認・訂正する前提で運用しています。」

つまり **「record がある」ことは「owner が判断した」ことではない**。両者は別の
主張であり、台帳の形は前者のみを示していた。Issue #720 の変更は、記録に
**provenance** を足し、owner の artefact が無い記録を gate が
**owner 確認待ち** として報告するようにすることだけである。

## 2. 分類の語彙

| kind | 意味 | gate の扱い |
| --- | --- | --- |
| `owner-review` | traceable な owner artefact（GitHub review / issue comment）がある | owner 承認として数える（`reference` と `ownerConfirmation: "confirmed"` が要る） |
| `agent-recorded` | 自動化された側が書いた記録。**レビューが準備された**という証拠であり、承認ではない | **owner 確認待ち**として報告する（`approval-owner-confirmation-missing`） |
| `unverified` | provenance が無い、または壊れている | 拒否する（`approval-provenance-missing`） |

判定に使った規則は 1 つだけである:

> **owner artefact が存在するか。** 存在するとは「owner がその判断を行ったことを
>述べる」artefact である insanity をいう。**記録の存在を述べるだけの artefact
>（"gate は PASS"、"owner record があります"）は owner 判断の artefact ではない。**
> 逆に、**owner が「その記録は agent が代理で書いた」と述べる artefact は、
> owner 判断の artefact ではない。**（それは逆の証拠である。）

## 3. 監査結果 — copy 編集承認台帳（6 件）

対象: `quality/copy-editorial-approvals.json`

| id | PR | reviewer | decision | 分類 | traceable な owner artefact | 場所 |
| --- | --- | --- | --- | --- | --- | --- |
| `pr-619` | #619 (release v0.7.0, base `main`) | `rebuildup` | approved | `agent-recorded` / `unconfirmed` | **無し**（owner comment は「gate は解消済み、owner record がある」と述べるだけ。copy を判断していない） | [PR #619 comment](https://github.com/rebuildup/my-web-2026/pull/619#issuecomment-6342648329) |
| `pr-644` | #644 (Issue #495) | `rebuildup` | approved | `agent-recorded` / `unconfirmed` | **無し**（owner comment は「編集レビューは pr-644 に記録、gate は PASS」と述べるだけ） | [Issue #495 comment](https://github.com/rebuildup/my-web-2026/issues/495#issuecomment-6334517047) |
| `pr-655` | #655 (Issue #621) | `rebuildup` | approved | `agent-recorded` / `unconfirmed` | **無し**（owner review はあるが verdict は REQUEST_CHANGES で「Draft の copy approval 待ちは指摘対象外」と明言している = copy の判断は保留） | [PR #655 review](https://github.com/rebuildup/my-web-2026/pull/655#pullrequestreview-5579990146) |
| `pr-661` | #661 (Issue #620) | `rebuildup` | approved | `agent-recorded` / `unconfirmed` | **無し**（owner comment は fingerprint と「PASS」のみ） | [Issue #620 comment](https://github.com/rebuildup/my-web-2026/issues/620#issuecomment-6337328849) |
| `pr-663` | #663 (Issue #502) | `rebuildup` | approved | `agent-recorded` / `unconfirmed` | **無し**（owner comment は「copy gate は解消済み、pr-663 の owner record がある」と述べるだけ） | [PR #619 comment](https://github.com/rebuildup/my-web-2026/pull/619#issuecomment-6342648329) |
| `pr-667` | #667 (Issue #662) | `rebuildup` | approved | `agent-recorded` / `unconfirmed` | **無し**（owner comment は「agent が代理で書いた」と明言） | [Issue #662 comment](https://github.com/rebuildup/my-web-2026/issues/662#issuecomment-6336047929) |

**owner 確認済みの記録: 0 件 / owner 確認待ち: 6 件。**

補足:

- 6 件すべての記録は agent の commit で追加された（`b12e0adf`, `7d67b0c2`,
  `520fdc37`, `54a7d97f`）。fingerprint・日付・proposal・comparisons は
  **一切変更していない**。追加したのは `provenance` だけである。
- `proposal` ブロックは **証拠としてそのまま残っている**。編集補助（yomiyasu
  と同種の道具）の出力は approval ではないという repository 自身の規則は
  変わらず、provenance はその規則を **台帳の側** にも固定したものである。

## 4. 監査結果 — 鮮度 registry（21 件）

対象: `quality/stale-content-review.json`。`reviewedBy` は全件 `"owner"`
（ Issue #437 の comment は「15 件」と数えている。後半 6 件は後から足された）。

### 4.1 最初の 15 件（commit `6db891ad`）

| id | surface (path) | reviewedBy / reviewedAt | 分類 | traceable な owner artefact |
| --- | --- | --- | --- | --- |
| `about-narrative-subset-empty` | `src/about/components/AboutPage.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | **無し**（owner comment は「agent が代理記入したレコードがあり、owner が内容を確認・訂正する前提で運用している」と述べる） |
| `about-current-heading` | `src/about/components/AboutPage.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `about-current-description` | `src/about/components/AboutPage.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `about-active-parked-legend` | `src/about/components/AboutPage.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `about-video-commission-parked` | `src/about/data.ts` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `contact-intro-current-only` | `src/contact/page.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `contact-intro-unpublished-excluded` | `src/contact/page.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `contact-commission-not-accepted` | `src/contact/page.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `contact-channels-heading-title` | `src/contact/page.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `contact-empty-no-reverified-channel` | `src/contact/page.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `contact-empty-add-instruction` | `src/contact/page.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `home-composer-channels-current` | `src/home/composer.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `home-status-latest-reachability` | `src/home/status/tiles.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上（この 1 件は `52320395` で note が更新されている） |
| `portfolio-seed-evidence-current-sale` | `src/portfolio/seed.ts` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `routes-contact-channels-current` | `src/routes/contact.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |

artefact（共通）: [Issue #437 comment](https://github.com/rebuildup/my-web-2026/issues/437#issuecomment-6337569318)

### 4.2 後から足された 6 件（commit `ba90980c`）

| id | surface (path) | reviewedBy / reviewedAt | 分類 | traceable な owner artefact |
| --- | --- | --- | --- | --- |
| `projects-dotfiles-freshness-unavailable` | `src/projects/DotfilesIntroductionPage.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | **無し**（owner comment は 15 件しか名指ししていない） |
| `projects-dotfiles-stale-notice` | `src/projects/DotfilesIntroductionPage.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `projects-dotfiles-missing-snapshot` | `src/projects/DotfilesIntroductionPage.tsx` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `projects-unavailable-not-public` | `src/projects/unavailable-copy.ts` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `projects-unavailable-not-current-suffix` | `src/projects/unavailable-copy.ts` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |
| `projects-unavailable-fallback-notice` | `src/projects/unavailable-copy.ts` | owner / 2026-10-22 | `agent-recorded` / `unconfirmed` | 同上 |

**owner 確認済みの記録: 0 件 / owner 確認待ち: 21 件。**

補足:

- **日付・reviewed expression・note・dimension は一切変更していない。**
  分類（provenance）の追加のみである（Issue #720 の指示どおり「re-classify,
  do not re-date」）。
- gate は `reviewedBy: "owner"` を **registry 自身の主張** として扱い、
  provenance を読む。鮮度ゲートは「owner がいつ読んだか」を **記録された主張**
  として報告し、owner artefact が無い記録を **owner 確認待ち** として示す。
- gate は依然として **日付の陳腐化**（current / stale）を判定し、
  **registry の日付を書き換えない**。provenance は日付とは別の軸である。

## 5. owner 確認が必要な記録の完全リスト

owner 確認が必要なのは **全 27 件**（copy 6 件 + 鮮度 21 件）である。

### 5.1 copy 編集承認台帳（6 件）

各 PR について、owner が次の 3 つを **行ってから**、その PR の record の
provenance を差し替える:

1. 当該 PR の変更された公開日本語を **原文と並べて** 読む（`comparisons[]` は
   既に書き下来的なので、**採否の判断**だけが残っている）。
2. その判断を **PR review または issue comment** として残す（traceable な
   artefact。gate が `reference` に指すのはこの URL である）。
3. `quality/copy-editorial-approvals.json` の該当 record の `provenance` を
   `kind: "owner-review"` / `reference: "<その URL>"` /
   `recordedBy: "<owner の識別子>"` / `ownerConfirmation: "confirmed"` に更新する。

対象 PR: **#619, #644, #655, #661, #663, #667**。

**fingerprint は変えない。** 変更集合は変わっていないので、fingerprint が
変わるなら変更集合を変えたことになる（その場合は別 PR の判断が必要）。

### 5.2 鮮度 registry（21 件）

1. 各 record の expression を **読み直す**。
2. 確認の根拠を **issue comment**（Issue #437、または新たな Issue）として残す。
3. record の `provenance` を `kind: "owner-review"` / `reference: "<その URL>"` /
   `recordedBy: "<owner の識別子>"` / `ownerConfirmation: "confirmed"` に更新する。

**`reviewedAt` は、owner が「確認した日」に更新してよい。ただし Issue #720 の
範囲内では日付を触っていない。** 日付の更新は owner が読むときに伴う 것으로
よい。

### 5.3 owner が何もしない場合

gate は **緑のまま** だが、報告は **「owner 確認待ち N 件」** を出す。copy
gate が緑であることは「公開日本語 copy に owner 承認がある」ことを意味 **しない**
（その主張ができるのは owner 確認済みの record だけである）。

## 6. 機械的に証明できること / できないこと

**証明できる**:

- record が owner artefact を **指しているか**（`reference` が存在するか）。
- record が `kind: "owner-review"` / `ownerConfirmation: "confirmed"` を
  **主張しているか**。
- その主張がない record は、gate が **owner 確認待ち** として報告すること。
- 台帳の全 record がこの 2 集団のどちらに入るか。

**証明できない**:

- **reference が指すものを誰が書いたか。** gate は reference の **形** を
  見る（文字列として存在するか、owner review / issue comment のような形か）だけ
  である。GitHub 上のそのコメントを、gate は **読まない**（offline /
  status-only が gate の契約である）。
- reference は **人間行動についての主張** である。repository はその主張を
  **記録する** が、**独立に証明はしない**。上の監査も、owner アカウントの
  comment が owner 本人の手書きであることを確認するまではできなかった。
- したがって **「owner が確認した」と書かれることと「owner が確認した」ことは
  別** であり、gate が前者しか検査できないのは、この repository の力学の
  限界である。

この限界は次で宣言されている:

- `scripts/check-copy-editorial-approval.mjs` のファイルヘッダ
- `scripts/check-stale-content-review.mjs` のファイルヘッダ
- `docs/runbook/copy-editorial-approval.md` §7
- `docs/runbook/stale-content-review.md`
- `docs/personal/owner.md`

## 7. この Issue が **していない** こと

- **record を削除していない。** 27 件すべてが残り、fingerprint・日付・
  before/after・proposal・note・expression は **一字も変わっていない**。
- **owner 承認を捏造していない。** traceable な owner artefact を確認できた
  record は 1 件も無いため、`kind: "owner-review"` は 1 件も作っていない。
- **既存 rule を弱めていない。** `no-approval-record` / `stale-approval` /
  fingerprint binding / proposal disposition / comparison の rule はそのまま
  動き、**追加** した。
- **`quality/wcag-review-matrix.json` に触れていない。** その台帳は Issue
  #722 の ticket が所有するファイルである（WCAG ledger は既に
  `auto-pass` / `human-verified` / `human-failed` / `not-reviewed` の語彙を
  持っており、`auto-pass` から `human-verified` への経路が無い）。この Issue
  の変更は **copy gate と鮮度 gate だけ** を対象にした。
- **gate を online にしていない。** 監査は作業者の側で行い、gate は引き続き
  git diff と 2 つの JSON だけを読む。
