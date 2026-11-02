# 監査窓の再定義と新しい close の記録 — Issue #815

- 対象: `scripts/check-issue-closure-remote.mjs`（`R005`）、
  `quality/issue-closure-ledger.json`（`audit.windows` / `entry.window`）、
  `docs/runbook/issue-lifecycle.md`
- owner 決定: **2026-11-02「窓を広げる」**（Issue #815）
- 状態: 実装・検証済み。2026-10-31 の 132 件は履歴として保持し、#808 を台帳に追加した

## 1. 何が起きていたか

`R005` は `audit.population`（132）と `entries.length` の一致を要求していた。
これは 2026-10-31 の一括 close を監査した時点の件数を**凍結**したもので、
台帳が「閉じた事実の記録」ではなく「その瞬間のスナップショット」としてしか
機能しない。新しい close を 1 件足した瞬間に gate が赤になるため、
2026-11-02 の #808 は台帳エントリを**あえて付けずに**閉じられていた。

実測（この Issue の着手前、#808 を台帳に追加した状態）:

```text
$ GITHUB_TOKEN=… node scripts/check-issue-closure-remote.mjs \
    --record=.tmp/measurements/ledger-with-808-legacy.json
R005 the ledger declares an audited population of 132, but it carries 133 entries
issue closure remote audit: 133 tracked issue(s), 37 closure(s) still closed since 2026-10-31 in rebuildup/my-web-2026
  closures with neither a ledger entry nor a trace: 0
  ledger / GitHub disagreements: 1
exit=1
```

## 2. 何を変えたか

`audit.population` という 1 つの数値を廃止し、`audit.windows` に置き換えた。
窓は日付範囲と、そこが対象とする母集団を持つ。

| 窓 | 範囲 | `population` | 意味 |
| --- | --- | --- | --- |
| `sweep-2026-10-31` | 2026-10-31 〜 2026-10-31 | `132`（frozen） | 一括 close の履歴。件数は動かせない。 |
| `tracked` | 2026-11-01 〜 open | `null`（derived） | 以後の close。母集団は entry 数から導出する。 |

`R005` の新しい意味は「**台帳の窓と entry が一致していること**」である。

- すべての entry は宣言済みの窓を `window` で指す（未指定・未知の窓は error）
- entry の `closedAt` はその窓の範囲内にある（範囲外は error）
- **frozen な窓は宣言した件数ちょうどの entry を持つ**（132 件を削っても
  水増ししても error）
- 窓どうしは重複しない（帰属が曖昧になるため error）
- derived な窓には件数の主張がないので、新しい close を足せる

つまり凍結が必要な履歴（2026-10-31）では従来どおり厳格で、
台帳が伸び続ける側では件数を数えない。`R005` は no-op になっていない。

## 3. 判定（前 / 後）

| 時点 | 台帳 | `issue:closure:check` | `issue:closure:audit` |
| --- | --- | --- | --- |
| 変更前（baseline） | 132 件 / `audit.population: 132` | **OK**（exit 0） | **OK**（exit 0、R005 なし） |
| 変更前 + #808 を 1 件追加 | 133 件 / `audit.population: 132` | OK（exit 0） | **R005 / exit 1**（本 Issue の欠陥） |
| 変更後 | 133 件 / `windows` 132 + 1 | **OK**（exit 0） | **OK**（exit 0、R005 なし） |

変更後のリモート gate 出力:

```text
issue closure remote audit: 133 tracked issue(s), 37 closure(s) still closed since 2026-10-31 in rebuildup/my-web-2026
  window sweep-2026-10-31: 132 recorded (frozen population 132)
  window tracked: 1 recorded (population derived from entries)
  closures with neither a ledger entry nor a trace: 0
  ledger / GitHub disagreements: 0
exit=0
```

## 4. #808 のエントリ

`#808`（開発面で portfolio のカバーが placeholder になる）は、
着手前に台帳エントリを持たずに close されていた。受け入れ条件と証拠は
Issue の close コメントで対応づけられており、`#809`（merge `4d6be456`）・
`#810`（merge `4778028c`）・`docs/verification/portfolio/dev-media-delivery.md`
を証拠として `implemented-and-verified` / `kept-closed` で記録した。

`recordedBy: "agent"` / `ownerConfirmation: "unconfirmed"` /
`ownerReference: null` のままである。agent は「何をしたか」を記録できるが、
「goal に到達した」ことを認定できない（AGENTS.md §6、Issue #741）。

## 5. テストで固定した新しい意味

`scripts/check-issue-closure-remote.test.mjs`:

- derived な窓に新しい close を足しても `R005` にならない（本 Issue の欠陥の再発防止）
- frozen な窓の件数が宣言と違えば `R005`
- `closedAt` が窓の範囲外なら `R005`
- 窓を指さない entry / 未知の窓を指す entry は `R005`
- 窓が重複すれば `R005`
- entry があるのに窓が宣言されていなければ `R005`
- derived な窓は件数を主張せず、summary が両方の意味を表示する
- `auditWindowStart` は最も早い窓の開始日を返す

## 6. 再現

```bash
node scripts/check-issue-closure.mjs
GITHUB_TOKEN=$(gh auth token) node scripts/check-issue-closure-remote.mjs
node --test scripts/check-issue-closure-remote.test.mjs
```

## 7. 残るリスク

1. **`R005` はネットワークを要する CI ステップでのみ走る**（設計どおり。
   `validate:fast` は offline 契約）。台帳の窓構造の誤りは push 後の CI で
   検出される。push 前に確認したい場合は上記の `issue:closure:audit` をローカルで実行する。
2. **台帳は自己参照的である**。`R005` は「宣言した窓」と「その entry」の
   食い違いを検出するが、窓の宣言ごと削除された場合は検出できない。
   2026-10-31 の 132 件が履歴として残っていることは、この記録と
   `sweepCommentCount: 124` が読者側の照合材料になる。
3. **frozen な窓の追加は owner 判断**である。今後、別の一括 close を
   凍結して監査する必要が生じた場合、窓を 1 つ増やすことはできるが、
   既存の窓の `population` を書き換える運用は認めない。
