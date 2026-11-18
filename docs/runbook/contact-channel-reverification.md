# Contact channel の定期再検証 (Issue #833)

`/contact` の channel 記録（`src/contact/channels.json`）は 2 つの独立した
契約で管理する。

| 契約 | 決めること | 実装 |
| --- | --- | --- |
| **表示の有効性** | その channel が実在し、連絡経路として使えるか | `active: true` + `verified_at` が parse 可能で非未来（`src/contact/schema.ts#selectDisplayableChannels`） |
| **定期監査** | 最終検証から何日経過したか | `verified_at`（JST の暦日）と `AUDIT_WINDOW_DAYS = 30`（同 `#auditChannelState`） |

**日付経過だけで channel は消えない。** 監査期限を超えた channel は
`due` として一覧に残り、「要再検証」の注記が付く。消えるのは
`active: false`（operator が退役させた）か、`verified_at` が
parse 不能・未来日で有効性を確認できない（`unknown`）場合だけ。

## 実行主体・頻度

- **実行主体**: owner（このリポジトリの運用者）。agent は channel の
  実在を確認できないため、再検証そのものは owner の作業。
- **頻度**: `pnpm run contact:freshness:check` の報告で `due` /
  `unknown` が出たとき。定期的には週 1 回程度、または deploy 前。

## 手順

1. `pnpm run contact:freshness:check` で現状を確認する
   （report-only。exit 0。`due` / `unknown` の channel id が列挙される）。
2. 各対象 channel について **2 軸**を再検証する（Issue #832 の契約）:
   - **URL 到達性**: その URL が HTTP で到達できるか
   - **連絡可否**: その経路が実際に連絡手段として使えるか
   検証方法と証跡の書き方は
   `docs/verification/contact/channel-verification-2026-11-03.md` と同型。
3. 結果を `docs/verification/contact/` に日付つきで記録する。
4. `src/contact/channels.json` を更新する:
   - 両軸 OK → `verified_at` を検証日（JST）に更新。`active` は維持。
   - 片方だけ成立 / 到達不能 → `active: false` にし、`$note` に
     実測の退役理由を書く。
   - **実証のない `verified_at` の延命は禁止**（Issue #832 O-1）。
5. `pnpm run contact:freshness:check` で `due` / `unknown` が
   解消したことを確認し、PR を出す。

## 公開面への影響

- `due` の channel は消えず「要再検証」注記つきで残る。訪問者は
  「最新の状態は未確認」と読める。
- `unknown`（parse 不能・未来日）の channel は公開面に出ない。
  全 active channel が `unknown` の場合、空状態は「要再検証」
  バリアント（`data-empty-reason="unverifiable"`）になる。
- 公開文言（注記・空状態）を変える場合は copy-editorial 承認
  ゲートの対象。`quality/copy-editorial-approvals.json` に
  `pending` 記録を作り、owner レビューを待つ。

## この runbook がやらないこと

- `contact:freshness:check` は報告のみで、`channels.json` を
  絶対に書き換えない・channel を自動削除しない。
- `AUDIT_WINDOW_DAYS` の値を変えるだけでは再検証の代わりにならない
  （Issue #833 の受け入れ条件）。
