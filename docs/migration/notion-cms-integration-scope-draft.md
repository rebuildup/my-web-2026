# Notion 接続の scope ドラフト（Issue #765）

> Status: **提案**。`quality/integration-scope.json` は **owner が編集する宣言** であり、
> allowlist entry は owner 専権（AGENTS.md §6 / `docs/runbook/issue-lifecycle.md`）。
> この文書は差分を提示するだけで、ledger・roster・workflow のいずれも変更しない。
> 実装は [`ADR-0018`](../adr/ADR-0018-notion-as-portfolio-cms-source-of-truth.md)（Accepted
> 2026-11-01）に従う。この文書自体はなお **提案** であり、`quality/integration-scope.json` の
> 変更は owner 専権のまま。

## 1. gate が実際に要求していること（実測）

`pnpm run integration:scope:check`（`scripts/check-integration-scope.mjs`）が
検査する項目のうち、Notion の採用に効くもの:

| 検査 | 挙動 | 出典 |
| --- | --- | --- |
| ledger の `status` と roster の status が一致すること | 不一致は **error** | `check-integration-scope.mjs:508` |
| `published_surface !== 'none'` の行は allowlist entry を必要とする | entry 無しは **error** | 同 `:538`–`:542` |
| `/integrations/*` が mount されていると entry 無しは **error** | — | 同 `:557` |
| allowlist entry の必須 field | `id` / `approved_by` / `approved_on` / `reason` | `ALLOWLIST_ENTRY_SHAPE` |
| `reason` | 20 文字以上の実質的な文 | `isRealReason(entry.reason, 20)` |
| `reviewed_connections` の verdict / code は **adapter が返す値と一致**すること | 宣言ではなく測定 | 同 `:403`–`:420` |
| secret 形の文字列が tracked tree に無いこと | 検出は error | 同 secret-shape 検査 |

さらに `allowlist.rule` の文言が明示している:

> A candidate may be published — a mounted `/integrations/*` route, **a token
> requested from the provider**, or any automated acceptance of a grant — only
> after the repository owner records an entry here.

**したがって allowlist entry は「route を出すとき」だけでなく「token を発行するとき」にも
必要である。** Notion の token を発行する以上、entry は必須。ここが gate の error 条件
（`published_surface`）だけを見ていると見落とす点なので、明記しておく。

## 2. 現在の状態（実測、2026-11-01）

```
github   not integrated  published_surface=none
notion   uncommitted     published_surface=none   ← 今回の対象
discord  uncommitted     published_surface=none
stripe   uncommitted     published_surface=none
allowlist.entries = []
```

gate は green（`ok notion uncommitted review deferred — no token may be requested`）。
`published_surface: none` は正しく、**この値を変える必要はない**。

## 3. snapshot 方式が ledger に与える影響

ADR-0018 §2 の方式（offline sync → committed snapshot）では:

| 項目 | 影響 |
| --- | --- |
| `/integrations/*` の mount | **なし**。`src/http/integrations/boundary.test.ts` の 404 を維持する |
| `published_surface` | **`none` のまま**。公開面に接続 surface は現れない |
| `wrangler*.jsonc#secrets.required` | **触らない**。token は Worker に到達しない（ADR-0018 §2.7） |
| `src/http/integrations/scope-review.ts` | **変更不要**。runtime で grant を評価しない |
| allowlist entry | **必要**（§1: token 発行が trigger） |
| roster の status | owner 判断。`uncommitted` のままでも gate は green |

つまり **変更は 2 箇所に閉じる**: allowlist entry（owner が書く）と、必要なら roster の
status 行（owner が書く）。コードの変更は 0。

## 4. 提案差分

### 4.1 `quality/integration-scope.json#allowlist.entries` に追加する 1 件

```jsonc
{
  "id": "notion",
  "approved_by": "<owner の GitHub login>",
  "approved_on": "<YYYY-MM-DD>",
  "reason": "<owner の言葉で、Notion の content を portfolio の authoring SoT として
              offline で読むことを許可する理由>"
}
```

- `approved_by` / `approved_on` / `reason` は **owner だけが記入できる**。agent は書かない。
  代筆すると `ownerConfirmation: unconfirmed` の捏造になる（AGENTS.md §6）。
- `reason` は 20 文字以上（gate）。「Notion に決めたから」では足りない —
  **何を SoT にするのか**（portfolio の文章・タグ・リンク）を書く。

### 4.2 roster（`docs/domain/integrations.md` 18 行目）の status

| 案 | 値 | 意味 |
| --- | --- | --- |
| **A（提案）** | `uncommitted` のまま | runtime に接続が無い事実は変わらない。roster は runtime の接続状態を語る表 |
| B | `offline tooling` 等の新しい語彙 | SoT が移ったことを roster に書く。ただし gate は roster の文字列と ledger の `status` の**一致**だけを見るので、両方を同じ語に変える必要がある |

A を提案する。roster の「current status」列は「Worker から繋がっているか」を語っており、
offline sync はその問いに答えない。SoT の所在は ADR-0018 と migration ledger が語る。
ただし owner が roster を「platform が Notion を SoT として読んでいるか」の表として
読んでいるなら B が正しい。**この判断は owner のもの。**

### 4.3 `integrations.notion.grant` — **drift を発見した（§5）**

現在: `"grant": "public_integration_oauth_token"`。
ADR-0018 の方式は **private / internal connection token**（workspace の設定で発行し、
対象 page / database を手動で共有する静的な credential）であり、OAuth フローを持たない。

`grant` は gate では非空文字列であることしか検査されない（`check-integration-scope.mjs:265`）。
したがって**値の変更は gate を通るが、owner の宣言の変更**なので agent は書かない。

## 5. 再検証で見つかった drift（2026-11-01 に vendor 文書を取得）

`quality/integration-scope.json` の notion 行は `source.verified_on: "2026-10-19"` で
あり、`source.note` が「promotion 前に再確認する」と指示している。取得した結果:

| ledger の記述 | 取得した vendor 文書の記述 | 判定 |
| --- | --- | --- |
| `token_retention.refresh: "interactive re-authorization; Notion issues no refresh token"` | OAuth token 応答に `refresh_token` が含まれ、refresh は新しい access token と**新しい refresh token** を発行する | **矛盾**。owner が ledger を直す必要がある |
| `grant: public_integration_oauth_token`（2 種の前提） |  credential は **3 種**（internal connection / PAT / public connection）として説明されている | **記述の不足** |
| `grant_note`: OAuth 応答に scope string は無い | scope field は無い（`access_token` / `refresh_token` / `bot_id` / `owner` / `workspace_*`） | **一致** |
| `grant_constraints`: capability は per-connection | 文書上は「connection capabilities」と書かれるが、per-connection か per-app かは明示されない | **未確認**（ledger の主張を vendor 文書だけでは裏付けられない） |
| `revocation.procedure`: workspace 設定から connection を削除 | 当該ページに revocation 手順の記載は無い | **未確認** |

**この表は fetch の要約であり、promotion の根拠にはしない。** owner（または
再検証を担う ticket）が原文を読み、ledger の該当 field を更新する。
特に refresh token の有無は `token_retention.refresh` と `reauth.error_codes`
（`provider_requires_reauth`）の意味を変えるので、放置しない。

> agent が ledger を直さない理由: ledger は owner の宣言であり、しかも
> 「refresh が無い」という前提で書かれた `reauth` の設計判断が含まれる。
> 事実の更新と設計判断の更新は同じ編集で行うべきで、それは owner の作業。

## 6. promotion の順序（この順でなければ sync スクリプトを実行しない）

1. ADR-0018 が owner により Accepted になる。
2. owner が §5 の drift を解消し、ledger の notion 行を現行 vendor 仕様に合わせる。
3. owner が §4.1 の allowlist entry を記録する。
4. owner が Infisical に `NOTION_TOKEN` を投入する（値は Issue / PR / ログに出さない）。
5. owner が Notion workspace に対象 database を作成し、connection に共有する。
6. その後に `scripts/sync-portfolio-notion.mjs` を初めて実行する。

1〜5 のどれかが欠けた状態で sync を走らせない（charter の制約「Notion API を呼ぶ前に
ADR と scope を整える」）。**この PR は 1〜6 のどれも実行していない。**

## 7. secret の取り扱い（名前のみ）

| 項目 | 値 |
| --- | --- |
| 名前 | `NOTION_TOKEN` |
| 命名規則 | `{PRODUCT_OR_LIB}_{ROLE}`（`docs/runbook/infisical-secrets.md` §3.2、64 文字以内、env suffix を付けない） |
| 所在 | Infisical。`dev` と `prod` を分ける場合も**同じ名前**で path / env を分ける |
| 読み手 | offline sync スクリプト（`scripts/**`）**のみ** |
| Worker | 読まない。`wrangler.jsonc` / `wrangler.production.jsonc` の `secrets.required` に**足さない** |
| 検証 | status-only。`scripts/check-cf-secrets.mjs` と同型の「MATCH / DIFFER / MISSING」出力のみ |
| 保持 | 90 日（`token_retention.max_age_days`）。sync スクリプトは token の `issued_at` を読めないため、**発行日は Infisical の secret metadata か運用記録に残す**必要がある（§8） |
| 失効 | ledger の `revocation.procedure`。24 時間以内 |

**値はこの文書にも Issue にも PR にも書かない。** この PR の diff に secret 形の文字列が
含まれないことは `integration:scope:check` が検査する。

## 8. 未決事項（owner）

1. **allowlist entry を記録するか**（記録しない限り token を発行しない）。§4.1。
2. **roster の status を変えるか**。§4.2 の A / B。
3. **`grant` を internal connection token に更新するか**（ADR-0018 の方式を採る場合）。
   §4.3 / §5。
4. **§5 の drift の解消**（特に refresh token の有無と `reauth` 設計）。
5. **token の発行日をどこに残すか**（Infisical metadata / 運用記録 / ledger の新しい field）。
   90 日 retention を運用で守るには発行日が必要で、現行 ledger には置き場所が無い。
6. **Notion 側の rate limit**（sync 頻度の上限を決めるのに要る）。ADR-0018 §5-2 と対。
