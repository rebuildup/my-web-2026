# 2026-10-31 母集団の訂正（132 → 133） — Issue #741 第 2 段階

- 対象: `quality/issue-closure-ledger.json`（`audit.windows[0].population` / `method` / `entries`）、
  [`docs/runbook/issue-lifecycle.md`](../../runbook/issue-lifecycle.md)（§4.1 の窓表 / §5 step 3）、
  [`closure-audit-2026-10-31.md`](closure-audit-2026-10-31.md)（§1 の母集団記述）
- 根拠: 第 1 段階の原典照合（Issue #741 コメント 6568788551、2026-11-02）
- 状態: **台帳の記録追加・訂正のみ**。Issue の close / reopen / コメントはしていない

## 1. 何が起きていたか

2026-11-01 の監査（[`closure-audit-2026-10-31.md`](closure-audit-2026-10-31.md)）は
母集団を **132 件** と書いた。その列挙方法は GitHub 検索 API の
`is:issue closed:2026-10-31` で、**`closedAt`（現在 open なら null）** を基準に
する。

**[#534](https://github.com/rebuildup/my-web-2026/issues/534) は同じ日に close され、同じ日に reopen された。**

実測（issue #534 の timeline）:

| event | 時刻 (UTC) |
| --- | --- |
| `closed` | 2026-10-31T02:43:36Z（sweep のコメント「回収完了（backlog / docs / spike；branchなし / PRなし）。」と同時刻） |
| `reopened` | 2026-10-31T19:54:35Z |

reopen された時点で `closedAt` は null になるため、`closed:2026-10-31` を用いた
検索母集団には**現れない**。これは監査の判定を誤ったものではなく、**列挙の
漏れ**である（remote gate の `listClosedIssues` も同じ制約をコードコメントに
書いている: "GitHub's search index only reports an issue while it is closed"）。

## 2. 実測（issue-events API による再列挙）

```text
$ gh api "repos/rebuildup/my-web-2026/issues/events?per_page=100" --paginate \
    --jq '.[] | select(.event=="closed" and (.created_at|startswith("2026-10-31"))) | .issue.number' \
  | sort -un | wc -l
157
```

157 個のうち **24 個は PR**（694 / 696 / 697 / 699 / 703 / 705〜717 / 725 / 727 / 729 / 731 / 735 / 736 / 738 —
いずれも `issues/{n}` が `pull_request` を持つ）で、**Issue は 133 件**。

| 母集団 | 件数 | 根拠 |
| --- | --- | --- |
| 監査レポート（2026-11-01） | 132 | `closed:2026-10-31` の検索（`closedAt` 基準） |
| 訂正後（2026-11-02） | **133** | issue-events API の `closed` イベント（当日 close された Issue 全件） |

差分の 1 件が #534 で、それ以外の 132 件は台帳と一致する（台帳に無い 24 個は
すべて PR）。

## 3. 何を直したか

| 場所 | before | after |
| --- | --- | --- |
| `audit.windows[0].population` | `132` | `133` |
| `audit.windows[0].method` | 検索 API のみ | 検索 API に加えて issue-events API による再列挙と、漏れの原因（同時日の close → reopen）を明記 |
| `entries[]` | 132 件（sweep 窓） | **133 件**（#534 を追加） |
| runbook §4.1 の窓表 | `132`（frozen） | `133`（frozen）。訂正の理由と訂正記録の所在を明記 |
| runbook §5 step 3 | 「frozen window の population は動かさない」 | 同じ規則を維持したまま、**今回の訂正が 언제・なぜ起きたか**を 1 段落足す |
| 監査レポート §1 | 「母集団は 132 件です」 | 133 件（訂正理由と本記録へのリンクを明記）。§3 の内訳と §7 の一覧は 2026-11-01 のスナップショットとして残し、訂正注記で明示 |

### #534 の entry

`state: planned-unimplemented` / `closure: unsupported` / `action: reopened`。
Miro 付箋 571 件の対応表は作られていない（原典ボードの読み取り経路が無い）。
GitHub 側の成果物（132 件の母集団照合・per-Issue 監査）と、Miro 未達の記録を
evidence に並べた。

## 4. 何を直していないか（規則は変えていない）

- **frozen window の population を entry 数に合わせる操作は引き続き禁止**である。
  runbook §5 step 3 の規則はそのまま残す。今回の訂正は「entry 数に合わせて
  population を書き換えた」のではなく、**列挙から漏れていた 1 件を母集団に戻し
  た**もので、差分の根拠（実測 157 − PR 24 = 133）を本記録に残している。
- **`R005` の規則自体は変えていない**。frozen window は「宣言した件数ちょうどの
  entry を持つ」ことを要求し、entry の帰属漏れや窓の外置きは error のまま。
- **Issue の状態は変えていない。** #534 は 2026-10-31 時点で既に reopen 済みで、
  本作業では close も reopen もしていない（台帳の `action: reopened` は GitHub の
  現在の状態と一致する）。

## 5. 訂正後の内訳（sweep 窓 133 件）

| 状態 | 件数 | 訂正前（132 件） |
| --- | --- | --- |
| 実装・実証まで完了（`implemented-and-verified`） | 27 | 25 |
| 一部のみ実装済み（`partial`） | 16 | 13 |
| 実装予定・未着手（`planned-unimplemented`） | 82 | 86 |
| 理由を明示して保留（`deferred-with-reason`） | 5 | 5 |
| 調査済みで結論あり（`research-complete-with-decision`） | 2 | 2 |
| 理由を明示して不採用（`explicitly-rejected-with-reason`） | 1 | 1 |

| closure | 件数 | 訂正前 |
| --- | --- | --- |
| クローズは妥当（`supported`） | 30 | 28 |
| クローズは不当（`unsupported`） | 92 | 93 |
| owner 判断待ち（`awaiting-owner`） | 11 | 11 |

| action | 件数 | 訂正前 |
| --- | --- | --- |
| 再オープン（`reopened`） | 103 | 102 |
| クローズ維持（`kept-closed`） | 30 | 30 |

owner 判断待ち 11 件（#61 / #202 / #317 / #318 / #320 / #321 / #322 / #330 / #331 /
#598 / #672）は**変わらない**（#330 / #331 の `closure` は `awaiting-owner` の
まま。変わったのは `state` と `evidence` だけ）。

## 6. 検証

| ゲート | 変更前 | 変更後 |
| --- | --- | --- |
| `pnpm run issue:closure:check`（offline） | exit 0 | exit 0（136 entries、error 0） |
| `pnpm run issue:closure:audit`（network） | exit 0 | exit 0（`R001`〜`R006` の finding 0） |

`R005` は「sweep 窓 133 entry = 宣言 133」で一致する。`R001`（記録も trace も
無い close）は 0、`R002` / `R003`（台帳と GitHub の状態不一致）も 0。

## 7. 関連

- Issue #741（親）: https://github.com/rebuildup/my-web-2026/issues/741
- 第 1 段階の原典照合コメント: https://github.com/rebuildup/my-web-2026/issues/741#issuecomment-6568788551
- 窓の再定義（Issue #815）: [`closure-window-2026-11-02.md`](closure-window-2026-11-02.md)
- runbook: [`docs/runbook/issue-lifecycle.md`](../../runbook/issue-lifecycle.md)
